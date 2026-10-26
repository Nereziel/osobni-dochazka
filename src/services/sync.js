/**
 * Synchronizační motor (Offline-first + Outbox queue + Conflict resolution)
 */
import { supabaseRequest, isSupabaseConfigured } from './supabase.js';
import {
  getPendingSyncActions,
  removeSyncAction,
  updateSyncAction,
  getUserDays,
  putUserDay,
  deleteUserDay,
  getUserSettings,
  putUserSettings
} from './indexedDb.js';
import { dayMetrics } from '../utils/attendance.js';

export function dayRowForSupabase(day, userKey, settings) {
  const m = dayMetrics(day, settings);
  return {
    user_key: userKey,
    date: day.date,
    type: day.type || 'work',
    start_time: day.start || '',
    end_time: day.end || '',
    manual_break: !!day.manualBreak,
    break_minutes: Number(day.breakMinutes) || 0,
    doctor_full_day: !!day.doctorFullDay,
    doctor_start: day.doctorStart || '',
    doctor_end: day.doctorEnd || '',
    other_minutes: Number(day.otherMinutes) || 0,
    worked_minutes: m.worked,
    credited_minutes: m.credited,
    target_minutes: m.target,
    balance_minutes: m.balance,
    note: day.note || '',
    updated_at: day.updatedAt || new Date().toISOString()
  };
}

export function localDayFromSupabaseRow(row, defaultBreakMinutes = 30) {
  return {
    date: row.date,
    type: row.type || 'work',
    start: row.start_time || '',
    end: row.end_time || '',
    manualBreak: !!row.manual_break,
    breakMinutes: Number.isFinite(row.break_minutes) ? row.break_minutes : defaultBreakMinutes,
    doctorFullDay: !!row.doctor_full_day,
    doctorStart: row.doctor_start || '',
    doctorEnd: row.doctor_end || '',
    otherMinutes: Number(row.other_minutes) || 0,
    note: row.note || '',
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

export function profileRowFromSettings(settings, user) {
  return {
    user_key: user.userKey,
    username: user.username,
    display_name: user.displayName || user.username,
    work_start: settings.workStart,
    work_end: settings.workEnd,
    daily_target_minutes: settings.dailyTargetMinutes,
    break_minutes: settings.breakMinutes,
    break_after_minutes: settings.breakAfterMinutes,
    auto_fill: !!settings.autoFill,
    work_days: settings.workDays,
    work_weekends: !!settings.workWeekends,
    weekend_mode: settings.weekendMode || 'none',
    weekend_custom_hours: !!settings.weekendCustomHours,
    weekend_start: settings.weekendStart || '07:00',
    weekend_end: settings.weekendEnd || '15:30',
    weekend_target_minutes: settings.weekendTargetMinutes ?? 480,
    work_on_holidays: !!settings.workOnHolidays,
    theme: settings.theme || 'system',
    settings_json: settings
  };
}

/**
 * Zpracování fronty neodeslaných offline změn (Outbox queue)
 */
export async function drainOutboxQueue(currentUser) {
  if (!isSupabaseConfigured() || !currentUser?.userKey) return 0;
  const actions = await getPendingSyncActions(currentUser.userKey);
  if (!actions || actions.length === 0) return 0;

  let successCount = 0;

  for (const item of actions) {
    try {
      if (item.entity === 'attendance_days') {
        if (item.action === 'UPSERT') {
          await supabaseRequest('/rest/v1/attendance_days?on_conflict=user_key,date', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(item.payload)
          }, currentUser);
        } else if (item.action === 'DELETE') {
          const q = `/rest/v1/attendance_days?user_key=eq.${encodeURIComponent(currentUser.userKey)}&date=eq.${encodeURIComponent(item.payload.date)}`;
          await supabaseRequest(q, { method: 'DELETE' }, currentUser);
        }
      } else if (item.entity === 'attendance_profiles') {
        if (item.action === 'UPDATE') {
          await supabaseRequest(`/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.userKey)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(item.payload)
          }, currentUser);
        }
      }

      await removeSyncAction(item.id);
      successCount++;
    } catch (err) {
      console.warn(`Zpracování sync položky ${item.id} selhalo:`, err);
      item.retries = (item.retries || 0) + 1;
      await updateSyncAction(item);
      // Pokud je síť nedostupná, přerušíme cyklus a zkusíme později
      break;
    }
  }

  return successCount;
}

/**
 * Plná synchronizace: Outbox -> Supabase Fetch -> Conflict Resolution (Last-Write-Wins)
 */
export async function performFullSync(currentUser, currentSettings, options = { pushLocalDays: true }) {
  if (!isSupabaseConfigured() || !currentUser?.userKey) {
    return { status: 'local' };
  }

  // 1. Nejdříve vyprázdnit outbox (aby se provedla i smazání a lokální offline úpravy)
  await drainOutboxQueue(currentUser);

  // 2. Načíst profil ze serveru
  let serverProfile = null;
  try {
    const profRows = await supabaseRequest(
      `/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.userKey)}&select=*`,
      {},
      currentUser
    );
    if (profRows?.[0]) serverProfile = profRows[0];
  } catch (err) {
    console.warn('Nelze načíst profil ze serveru:', err);
  }

  // 3. Načíst dny z cloudu
  const remoteRows = await supabaseRequest(
    `/rest/v1/attendance_days?user_key=eq.${encodeURIComponent(currentUser.userKey)}&select=*&order=date.asc`,
    {},
    currentUser
  );

  const remoteMap = new Map();
  for (const r of (remoteRows || [])) {
    remoteMap.set(r.date, localDayFromSupabaseRow(r, currentSettings?.breakMinutes ?? 30));
  }

  // 4. Načíst lokální dny z IndexedDB
  const localList = await getUserDays(currentUser.userKey);
  const localMap = new Map(localList.map(d => [d.date, d]));

  // Zjistit, které dny jsou v pending frontě pro DELETE
  const pendingActions = await getPendingSyncActions(currentUser.userKey);
  const pendingDeleteDates = new Set(
    pendingActions
      .filter(a => a.entity === 'attendance_days' && a.action === 'DELETE')
      .map(a => a.payload.date)
  );

  const toUpload = [];
  const mergedMap = new Map();

  // Zpracovat lokální záznamy
  for (const [date, localDay] of localMap.entries()) {
    if (pendingDeleteDates.has(date)) {
      // Položka čeká na smazání na serveru, neobnovovat
      continue;
    }

    const rem = remoteMap.get(date);
    if (!rem) {
      if (options.pushLocalDays) {
        toUpload.push(dayRowForSupabase(localDay, currentUser.userKey, currentSettings));
      }
      mergedMap.set(date, localDay);
    } else {
      // Conflict resolution: Last-Write-Wins
      const locTime = Date.parse(localDay.updatedAt || '') || 0;
      const remTime = Date.parse(rem.updatedAt || '') || 0;

      if (locTime > remTime && options.pushLocalDays) {
        toUpload.push(dayRowForSupabase(localDay, currentUser.userKey, currentSettings));
        mergedMap.set(date, localDay);
      } else {
        mergedMap.set(date, rem);
        await putUserDay(currentUser.userKey, rem);
      }
    }
  }

  // Zpracovat vzdálené záznamy, které lokálně chybí
  for (const [date, remDay] of remoteMap.entries()) {
    if (pendingDeleteDates.has(date)) continue;
    if (!mergedMap.has(date)) {
      mergedMap.set(date, remDay);
      await putUserDay(currentUser.userKey, remDay);
    }
  }

  // Nahrát na server lokální záznamy, které jsou novější nebo nové
  if (toUpload.length > 0) {
    await supabaseRequest('/rest/v1/attendance_days?on_conflict=user_key,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(toUpload)
    }, currentUser);
  }

  return {
    status: 'online',
    recordsMap: mergedMap,
    serverProfile
  };
}

