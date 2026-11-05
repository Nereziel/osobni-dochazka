import { ref, computed, getCurrentInstance, onMounted, onUnmounted } from 'vue';
import {
  getUserDays,
  putUserDay,
  deleteUserDay,
  putUserDayWithOutbox,
  deleteUserDayWithOutbox,
  removeSyncAction
} from '../services/indexedDb.js';
import { dayRowForSupabase } from '../services/sync.js';
import { supabaseRequest } from '../services/supabase.js';
import {
  localDateKey,
  startOfMonth,
  todayKey,
  isWeekendDate,
  fmtWeekdayShort,
  getDaysInMonth
} from '../utils/dates.js';
import {
  dayMetrics,
  monthStats as calcMonthStats,
  yearVacationUsed as calcYearVacation,
  monthVacationDays as calcMonthVacation,
  findActiveShiftRecord,
  baseTargetForDate,
  defaultHoursForDate,
  TYPE_LABELS
} from '../utils/attendance.js';
import { cloneDeep } from '../utils/validation.js';
import { holidayName } from '../utils/holidays.js';
import { formatDuration, pad } from '../utils/time.js';
import { sanitizeSpreadsheetCell } from '../utils/security.js';

const records = ref(new Map());
const calendarMonth = ref(startOfMonth(new Date()));
const timesheetMonth = ref(startOfMonth(new Date()));
const currentTodayKey = ref(todayKey());
const clockTick = ref(new Date());

export function useAttendance() {
  // Date changes during a long-running PWA session (including midnight rollover).
  // Composable is also exercised in unit tests without a mounted Vue component.
  if (getCurrentInstance()) {
    let timer = null;
    const refreshClock = () => {
      const now = new Date();
      clockTick.value = now;
      currentTodayKey.value = localDateKey(now);
    };
    onMounted(() => {
      refreshClock();
      timer = setInterval(refreshClock, 15000);
      if (typeof window !== 'undefined') window.addEventListener('focus', refreshClock);
    });
    onUnmounted(() => {
      if (timer) clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('focus', refreshClock);
    });
  }

  async function loadRecords(userId) {
    if (!userId) {
      records.value = new Map();
      return;
    }
    const days = await getUserDays(userId);
    records.value = new Map(days.map(d => [d.date, d]));
  }

  async function saveDay(day, currentUser, settings, skipCloud = false) {
    const userId = currentUser?.userKey || 'user:local';
    const updated = {
      ...day,
      updatedAt: new Date().toISOString()
    };
    const shouldSync = !skipCloud && Boolean(currentUser?.userKey);
    const row = shouldSync ? dayRowForSupabase(updated, userId, settings) : null;

    // Both the local row and the pending cloud mutation commit atomically.
    const queueId = shouldSync
      ? await putUserDayWithOutbox(userId, updated, row)
      : null;
    if (!shouldSync) await putUserDay(userId, updated);

    records.value.set(updated.date, updated);
    records.value = new Map(records.value);

    if (!shouldSync) return { ...updated, syncStatus: 'local' };

    try {
      const upRes = await supabaseRequest('/rest/v1/rpc/upsert_attendance_day_lww', {
        method: 'POST',
        body: JSON.stringify({ p_day: row })
      }, currentUser);

      if (upRes?.applied !== true) {
        // Never remove the outbox item or claim cloud success after server_newer.
        console.warn('Cloud má novější zápis tohoto dne; lokální změna zůstává uložená.', updated.date);
        return { ...updated, syncStatus: 'conflict' };
      }

      // Do not normalize an older response over a newer local edit of the same day.
      if (upRes.server_updated_at && upRes.server_updated_at !== updated.updatedAt &&
          records.value.get(updated.date)?.updatedAt === updated.updatedAt) {
        const normalized = { ...updated, updatedAt: upRes.server_updated_at };
        await putUserDay(userId, normalized);
        if (records.value.get(updated.date)?.updatedAt === updated.updatedAt) {
          records.value.set(updated.date, normalized);
          records.value = new Map(records.value);
        }
      }
      await removeSyncAction(queueId);
      return { ...updated, syncStatus: 'synced' };
    } catch (err) {
      // Outbox was already committed. Leave it for retry, do not enqueue a duplicate.
      console.warn('Cloudové uložení dne se odkládá; lokální záznam je zachovaný:', err);
      return { ...updated, syncStatus: 'queued' };
    }
  }

  async function deleteDay(dateKey, currentUser, skipCloud = false) {
    const userId = currentUser?.userKey || 'user:local';
    const shouldSync = !skipCloud && Boolean(currentUser?.userKey);
    const nowIso = new Date().toISOString();
    const tombstone = shouldSync ? {
      user_key: userId,
      date: dateKey,
      deleted_at: nowIso,
      updated_at: nowIso
    } : null;

    const queueId = shouldSync
      ? await deleteUserDayWithOutbox(userId, dateKey, tombstone)
      : null;
    if (!shouldSync) await deleteUserDay(userId, dateKey);

    records.value.delete(dateKey);
    records.value = new Map(records.value);
    if (!shouldSync) return { syncStatus: 'local' };

    try {
      const res = await supabaseRequest('/rest/v1/rpc/upsert_attendance_day_lww', {
        method: 'POST',
        body: JSON.stringify({ p_day: tombstone })
      }, currentUser);
      if (res?.applied !== true) {
        console.warn('Cloud má novější verzi smazaného dne; lokální tombstone zůstává v outboxu.', dateKey);
        return { syncStatus: 'conflict' };
      }
      await removeSyncAction(queueId);
      return { syncStatus: 'synced' };
    } catch (err) {
      console.warn('Cloudové smazání dne se odkládá; tombstone je v outboxu:', err);
      return { syncStatus: 'queued' };
    }
  }

  async function quickToday(mutator, currentUser, settings, options = {}) {
    const key = options.preferOpenShift && activeShiftRecord.value
      ? activeShiftRecord.value.date
      : todayKey();
    const existing = records.value.get(key);
    const hours = defaultHoursForDate(key, settings);

    const baseDay = existing ? cloneDeep(existing) : {
      date: key,
      type: 'work',
      start: settings.autoFill ? hours.start : '',
      end: settings.autoFill ? hours.end : '',
      manualBreak: false,
      breakMinutes: settings.breakMinutes,
      doctorFullDay: false,
      doctorStart: '',
      doctorEnd: '',
      otherMinutes: 0,
      note: ''
    };

    mutator(baseDay, hours);
    return saveDay(baseDay, currentUser, settings);
  }

  async function fillMissingDaysInMonth(monthDate, currentUser, settings) {
    const d = monthDate instanceof Date ? monthDate : startOfMonth(monthDate);
    const year = d.getFullYear();
    const month = d.getMonth();
    const daysCount = getDaysInMonth(year, month);
    const today = todayKey();
    let filled = 0;

    for (let dayNum = 1; dayNum <= daysCount; dayNum++) {
      const dateObj = new Date(year, month, dayNum, 12, 0, 0, 0);
      const key = localDateKey(dateObj);
      const target = baseTargetForDate(key, settings);

      if (target > 0 && key <= today && !records.value.has(key)) {
        const hours = defaultHoursForDate(key, settings);
        const day = {
          date: key,
          type: 'work',
          start: hours.start,
          end: hours.end,
          manualBreak: false,
          breakMinutes: settings.breakMinutes,
          doctorFullDay: false,
          doctorStart: '',
          doctorEnd: '',
          otherMinutes: 0,
          note: ''
        };
        await saveDay(day, currentUser, settings);
        filled++;
      }
    }

    return filled;
  }

  function exportCsv(monthDate, settings) {
    const d = monthDate instanceof Date ? monthDate : startOfMonth(monthDate);
    const year = d.getFullYear();
    const month = d.getMonth();
    const daysInMonth = getDaysInMonth(year, month);

    const rows = [
      ['Datum', 'Den', 'Typ dne', 'Příchod', 'Odchod', 'Přestávka (min)', 'Odpracováno', 'Omluveno', 'Fond', 'Saldo', 'Poznámka']
    ];

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dateObj = new Date(year, month, dayNum, 12, 0, 0, 0);
      const key = localDateKey(dateObj);
      const rec = records.value.get(key);
      const m = rec
        ? dayMetrics(rec, settings)
        : { worked: 0, credited: 0, target: baseTargetForDate(key, settings), balance: 0, breakMinutes: 0 };

      rows.push([
        key,
        fmtWeekdayShort(dateObj),
        rec ? (TYPE_LABELS[rec.type] || rec.type) : (holidayName(key) || (isWeekendDate(dateObj) ? 'Víkend' : '')),
        rec?.start || '',
        rec?.end || '',
        rec ? String(m.breakMinutes) : '0',
        formatDuration(m.worked),
        formatDuration(m.credited),
        formatDuration(m.target),
        formatDuration(m.balance, true),
        sanitizeSpreadsheetCell(rec?.note || '').replace(/"/g, '""')
      ]);
    }

    const csvContent = '\uFEFF' + rows.map(r => r.map(c => `"${c}"`).join(';')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vykaz-dochazky-${year}-${pad(month + 1)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const todayRecord = computed(() => records.value.get(currentTodayKey.value) || null);
  const activeShiftRecord = computed(() => findActiveShiftRecord(records.value, clockTick.value));

  const activeShift = computed(() => {
    const rec = activeShiftRecord.value;
    if (rec) {
      return {
        isActive: true,
        date: rec.date,
        startTime: rec.start,
        type: rec.type,
        typeLabel: TYPE_LABELS[rec.type] || 'Práce',
        manualBreak: !!rec.manualBreak,
        breakMinutes: rec.breakMinutes
      };
    }
    return { isActive: false, date: '', startTime: '', type: '', typeLabel: '', manualBreak: false, breakMinutes: null };
  });

  return {
    records,
    calendarMonth,
    timesheetMonth,
    loadRecords,
    saveDay,
    deleteDay,
    quickToday,
    fillMissingDaysInMonth,
    exportCsv,
    currentTodayKey,
    todayRecord,
    activeShiftRecord,
    activeShift,
    calcMonthStats: (date, settings) => calcMonthStats(date, records.value, settings, currentTodayKey.value),
    calcYearVacation: (year) => calcYearVacation(year, records.value),
    calcMonthVacation: (date) => calcMonthVacation(date, records.value)
  };
}
