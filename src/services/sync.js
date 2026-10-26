/**
 * Synchronizační motor (Offline-first + Outbox queue + Conflict resolution)
 *
 * Principy:
 * 1. Atomický server-side Last-Write-Wins (LWW) přes RPC upsert_attendance_day_lww
 * 2. Skutečné tombstones pro DELETE (deleted_at timestamptz)
 * 3. Idempotentní zpracování outbox fronty
 * 4. Sloučení více změn stejného dne v outboxu (coalesce)
 * 5. Žádné oživení smazaného záznamu starší lokální verzí
 */
import { supabaseRequest, isSupabaseConfigured } from './supabase.js';
import {
  getPendingSyncActions,
  removeSyncAction,
  updateSyncAction,
  getUserDays,
  putUserDay,
  deleteUserDay
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
    deleted_at: day.deletedAt || null,
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
    deletedAt: row.deleted_at || null,
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
 * Optimalizace outbox fronty: sloučí vícenásobné změny stejného dne
 * Pokud je den nejprve upraven a poté smazán, zachová se pouze finální DELETE (tombstone).
 * Pokud je více UPSERTů pro stejný den, zachová se nejnovější.
 */
export function coalesceOutboxActions(actions) {
  if (!Array.isArray(actions) || actions.length <= 1) return actions ? [...actions] : [];

  const dayActionsByDate = new Map();
  const profileActions = [];
  const otherActions = [];

  for (const item of actions) {
    if (item.entity === 'attendance_days' && item.payload?.date) {
      const date = item.payload.date;
      const existing = dayActionsByDate.get(date);

      if (!existing) {
        dayActionsByDate.set(date, item);
      } else {
        const existingTime = Date.parse(existing.payload.updated_at || existing.createdAt || '') || 0;
        const incomingTime = Date.parse(item.payload.updated_at || item.createdAt || '') || 0;

        // Pokud je novější položka novější, nahradíme ji (id necháme pro vymazání obou nebo použijeme novější)
        if (incomingTime >= existingTime) {
          // Uložíme IDs k vyčištění
          const mergedObsoleteIds = [...(existing.obsoleteIds || []), existing.id];
          dayActionsByDate.set(date, {
            ...item,
            obsoleteIds: mergedObsoleteIds
          });
        } else {
          // Stávající byla novější, tuto označíme jako zastaralou
          existing.obsoleteIds = [...(existing.obsoleteIds || []), item.id];
        }
      }
    } else if (item.entity === 'attendance_profiles') {
      profileActions.push(item);
    } else {
      otherActions.push(item);
    }
  }

  return [...dayActionsByDate.values(), ...profileActions, ...otherActions];
}

/**
 * Zpracování fronty neodeslaných offline změn (Outbox queue)
 * Používá atomickou server-side LWW RPC funkci a tombstones.
 */
export async function drainOutboxQueue(currentUser) {
  if (!isSupabaseConfigured() || !currentUser?.userKey) return 0;
  const rawActions = await getPendingSyncActions(currentUser.userKey);
  if (!rawActions || rawActions.length === 0) return 0;

  const actions = coalesceOutboxActions(rawActions);
  let successCount = 0;

  for (const item of actions) {
    try {
      if (item.entity === 'attendance_days') {
        const payload = item.payload;
        // Zajištění správného payloadu pro RPC
        const rpcPayload = {
          user_key: currentUser.userKey,
          date: payload.date,
          type: payload.type || 'work',
          start_time: payload.start_time || payload.start || '',
          end_time: payload.end_time || payload.end || '',
          manual_break: !!payload.manual_break,
          break_minutes: Number(payload.break_minutes) || 0,
          doctor_full_day: !!payload.doctor_full_day,
          doctor_start: payload.doctor_start || '',
          doctor_end: payload.doctor_end || '',
          other_minutes: Number(payload.other_minutes) || 0,
          worked_minutes: Number(payload.worked_minutes) || 0,
          credited_minutes: Number(payload.credited_minutes) || 0,
          target_minutes: Number(payload.target_minutes) || 0,
          balance_minutes: Number(payload.balance_minutes) || 0,
          note: payload.note || '',
          deleted_at: item.action === 'DELETE' ? (payload.deleted_at || new Date().toISOString()) : (payload.deleted_at || null),
          updated_at: payload.updated_at || new Date().toISOString()
        };

        const res = await supabaseRequest('/rest/v1/rpc/upsert_attendance_day_lww', {
          method: 'POST',
          body: JSON.stringify({ p_day: rpcPayload })
        }, currentUser);

        // Pokud server záznam odmítl jako server_newer, je to korektní vyřešení konfliktu!
        // Položka z outboxu se odstraní, protože na serveru již existuje novější pravda.
        if (res?.applied === false && res?.reason === 'server_newer') {
          console.info(`Outbox pro den ${payload.date} byl bezpečně odmítnut (server má novější verzi ${res.server_updated_at}).`);
        }
      } else if (item.entity === 'attendance_profiles') {
        if (item.action === 'UPDATE') {
          await supabaseRequest('/rest/v1/rpc/update_own_settings', {
            method: 'POST',
            body: JSON.stringify({ p_settings: item.payload })
          }, currentUser);
        }
      }

      // Odstranění hlavní položky i případných sloučených zastaralých položek
      await removeSyncAction(item.id);
      if (Array.isArray(item.obsoleteIds)) {
        for (const obsId of item.obsoleteIds) {
          try {
            await removeSyncAction(obsId);
          } catch {
            // ignorujeme
          }
        }
      }

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

let lastSuccessfulPullTimestamps = new Map();

export function getLastSuccessfulPullAt(userKey) {
  return lastSuccessfulPullTimestamps.get(userKey) || null;
}

export function setLastSuccessfulPullAt(userKey, timestamp) {
  if (timestamp) {
    lastSuccessfulPullTimestamps.set(userKey, timestamp);
  } else {
    lastSuccessfulPullTimestamps.delete(userKey);
  }
}

/**
 * Plná nebo inkrementální synchronizace: Outbox -> Supabase Fetch -> Conflict Resolution (Last-Write-Wins + Tombstones)
 */
export async function performFullSync(
  currentUser,
  currentSettings,
  options = { pushLocalDays: true, incremental: false, fetchProfile: true }
) {
  if (!isSupabaseConfigured() || !currentUser?.userKey) {
    return { status: 'local' };
  }

  // 1. Nejprve atomicky zpracovat frontu outboxu (LWW na serveru)
  await drainOutboxQueue(currentUser);

  // 2. Načíst profil ze serveru (pouze pokud je výslovně požadován nebo při full syncu)
  let serverProfile = null;
  const shouldFetchProfile = options.fetchProfile !== false && !options.incremental;
  if (shouldFetchProfile) {
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
  }

  // 3. Dotaz na dny: plný vs inkrementální s 15s bezpečnostním překrytím (overlap window)
  const lastPull = getLastSuccessfulPullAt(currentUser.userKey);
  const isIncremental = Boolean(options.incremental && lastPull);
  let daysUrl = `/rest/v1/attendance_days?user_key=eq.${encodeURIComponent(currentUser.userKey)}&select=*&order=date.asc`;

  if (isIncremental) {
    const overlapIso = new Date(Date.parse(lastPull) - 15000).toISOString();
    daysUrl += `&updated_at=gte.${encodeURIComponent(overlapIso)}`;
  }

  const remoteRows = await supabaseRequest(daysUrl, {}, currentUser);

  // Rychlá optimalizace: pokud při 5s pollingu nepřibyla žádná změna na serveru
  if (isIncremental && (!remoteRows || remoteRows.length === 0) && !options.pushLocalDays) {
    setLastSuccessfulPullAt(currentUser.userKey, new Date().toISOString());
    const localList = await getUserDays(currentUser.userKey);
    return {
      status: 'online',
      recordsMap: new Map(localList.map(d => [d.date, d])),
      serverProfile
    };
  }

  const remoteMap = new Map();
  for (const r of (remoteRows || [])) {
    remoteMap.set(r.date, localDayFromSupabaseRow(r, currentSettings?.breakMinutes ?? 30));
  }

  // 4. Načíst lokální dny z IndexedDB
  const localList = await getUserDays(currentUser.userKey);
  const localMap = new Map(localList.map(d => [d.date, d]));

  // Zjistit, které dny ještě čekají v outboxu (např. pokud se nepodařilo odeslat vše)
  const pendingActions = await getPendingSyncActions(currentUser.userKey);
  const pendingDates = new Set(
    pendingActions
      .filter(a => a.entity === 'attendance_days' && a.payload?.date)
      .map(a => a.payload.date)
  );

  const toUpload = [];
  const mergedMap = new Map();

  // Zpracovat lokální záznamy
  for (const [date, localDay] of localMap.entries()) {
    if (pendingDates.has(date)) {
      // Položka má čekající offline změnu v outboxu, nepřepisujeme ji
      mergedMap.set(date, localDay);
      continue;
    }

    const rem = remoteMap.get(date);
    if (!rem) {
      // Záznam na serveru zatím vůbec není -> nahrát jako nový
      if (options.pushLocalDays) {
        toUpload.push(dayRowForSupabase(localDay, currentUser.userKey, currentSettings));
      }
      mergedMap.set(date, localDay);
    } else {
      const locTime = Date.parse(localDay.updatedAt || '') || 0;
      const remTime = Date.parse(rem.updatedAt || '') || 0;

      // Pokud má server novější tombstone (deleted_at), lokální záznam se smaže
      if (rem.deletedAt) {
        if (remTime >= locTime) {
          // Serverový delete je novější nebo stejně nový -> odstranit lokálně
          await deleteUserDay(currentUser.userKey, date);
          // Nezařazujeme do mergedMap (den je smazán)
          continue;
        } else {
          // Lokální změna je novější než serverový delete -> oživit a nahrát na server
          if (options.pushLocalDays) {
            toUpload.push(dayRowForSupabase(localDay, currentUser.userKey, currentSettings));
          }
          mergedMap.set(date, localDay);
        }
      } else {
        // Běžné porovnání LWW
        if (locTime > remTime && options.pushLocalDays) {
          toUpload.push(dayRowForSupabase(localDay, currentUser.userKey, currentSettings));
          mergedMap.set(date, localDay);
        } else {
          mergedMap.set(date, rem);
          await putUserDay(currentUser.userKey, rem);
        }
      }
    }
  }

  // Zpracovat vzdálené záznamy, které lokálně chybí (nebo které ještě nebyly sloučeny)
  for (const [date, remDay] of remoteMap.entries()) {
    if (pendingDates.has(date)) continue;

    // Pokud už byl den zpracován v předchozím kroku (např. lokální záznam byl novější a oživil jej), přeskočíme
    if (mergedMap.has(date)) continue;

    // Pokud je vzdálený záznam smazaný (tombstone), ignorujeme jej pro lokální zobrazení
    if (remDay.deletedAt) {
      if (localMap.has(date)) {
        await deleteUserDay(currentUser.userKey, date);
      }
      continue;
    }

    mergedMap.set(date, remDay);
    await putUserDay(currentUser.userKey, remDay);
  }

  // Odeslat případné novější lokální záznamy přes bezpečnou atomickou LWW RPC
  if (toUpload.length > 0) {
    for (const row of toUpload) {
      try {
        await supabaseRequest('/rest/v1/rpc/upsert_attendance_day_lww', {
          method: 'POST',
          body: JSON.stringify({ p_day: row })
        }, currentUser);
      } catch (err) {
        console.warn(`LWW upload pro den ${row.date} selhal, řadím do outboxu:`, err);
        await enqueueSyncAction(currentUser.userKey, 'attendance_days', 'UPSERT', row);
      }
    }
  }

  setLastSuccessfulPullAt(currentUser.userKey, new Date().toISOString());

  return {
    status: 'online',
    recordsMap: mergedMap,
    serverProfile
  };
}
