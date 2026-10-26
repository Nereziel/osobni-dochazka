import { ref, computed } from 'vue';
import {
  getUserDays,
  putUserDay,
  deleteUserDay,
  enqueueSyncAction
} from '../services/indexedDb.js';
import { dayRowForSupabase } from '../services/sync.js';
import { supabaseRequest, isSupabaseConfigured } from '../services/supabase.js';
import {
  localDateKey,
  startOfMonth,
  addMonths,
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
  allowsWork,
  baseTargetForDate,
  defaultHoursForDate,
  TYPE_LABELS
} from '../utils/attendance.js';
import { cloneDeep } from '../utils/validation.js';
import { holidayName } from '../utils/holidays.js';
import { formatDuration, pad, formatClock } from '../utils/time.js';

const records = ref(new Map());
const calendarMonth = ref(startOfMonth(new Date()));
const timesheetMonth = ref(startOfMonth(new Date()));

export function useAttendance() {
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

    await putUserDay(userId, updated);
    records.value.set(updated.date, updated);

    // Reaktivní trigger
    records.value = new Map(records.value);

    if (!skipCloud && isSupabaseConfigured() && currentUser?.userKey) {
      const row = dayRowForSupabase(updated, currentUser.userKey, settings);
      try {
        await supabaseRequest('/rest/v1/rpc/upsert_attendance_day_lww', {
          method: 'POST',
          body: JSON.stringify({ p_day: row })
        }, currentUser);
      } catch (err) {
        console.warn('Uložení dne do cloudu selhalo, zařazeno do outboxu:', err);
        await enqueueSyncAction(userId, 'attendance_days', 'UPSERT', row);
      }
    }

    return updated;
  }

  async function deleteDay(dateKey, currentUser, skipCloud = false) {
    const userId = currentUser?.userKey || 'user:local';
    await deleteUserDay(userId, dateKey);
    records.value.delete(dateKey);
    records.value = new Map(records.value);

    if (!skipCloud && isSupabaseConfigured() && currentUser?.userKey) {
      const nowIso = new Date().toISOString();
      const tombstonePayload = {
        user_key: currentUser.userKey,
        date: dateKey,
        deleted_at: nowIso,
        updated_at: nowIso
      };

      try {
        await supabaseRequest('/rest/v1/rpc/upsert_attendance_day_lww', {
          method: 'POST',
          body: JSON.stringify({ p_day: tombstonePayload })
        }, currentUser);
      } catch (err) {
        console.warn('Smazání dne v cloudu selhalo, zařazeno do outboxu jako tombstone:', err);
        await enqueueSyncAction(userId, 'attendance_days', 'DELETE', tombstonePayload);
      }
    }
  }

  async function quickToday(mutator, currentUser, settings) {
    const key = todayKey();
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
        (rec?.note || '').replace(/"/g, '""')
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

  // Komputované statistiky pro Dnes
  const currentTodayKey = computed(() => todayKey());
  const todayRecord = computed(() => records.value.get(currentTodayKey.value) || null);

  const activeShift = computed(() => {
    const rec = todayRecord.value;
    if (rec && allowsWork(rec.type) && rec.start && !rec.end) {
      return {
        isActive: true,
        startTime: rec.start,
        type: rec.type,
        typeLabel: TYPE_LABELS[rec.type] || 'Práce'
      };
    }
    return { isActive: false, startTime: '', type: '', typeLabel: '' };
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
    activeShift,
    calcMonthStats: (date, settings) => calcMonthStats(date, records.value, settings),
    calcYearVacation: (year) => calcYearVacation(year, records.value),
    calcMonthVacation: (date) => calcMonthVacation(date, records.value)
  };
}

