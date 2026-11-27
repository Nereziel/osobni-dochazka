/**
 * IndexedDB vrstva pro Osobní docházku (verze 4)
 * Zajišťuje:
 * - Rozdělení záznamů podle uživatele ([userId, date])
 * - Per-user nastavení
 * - Perzistentní frontu synchronizačních změn (Outbox queue)
 * - Bezeztrátovou automatickou migraci ze staré verze (v1/v2/v3)
 */

const DB_NAME = 'dochazka-win11-db';
const DB_VERSION = 4;

let dbInstance = null;

export function openDatabase() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      const tx = req.transaction;

      if (!db.objectStoreNames.contains('user_days')) {
        const store = db.createObjectStore('user_days', { keyPath: ['userId', 'date'] });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('user_settings')) {
        db.createObjectStore('user_settings', { keyPath: 'userId' });
      }

      if (!db.objectStoreNames.contains('sync_queue')) {
        const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        queueStore.createIndex('userId', 'userId', { unique: false });
        queueStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (oldVersion > 0 && oldVersion < 4) {
        try {
          let activeUserKey = 'user:local';
          try {
            const raw = localStorage.getItem('dochazka_active_user_v2') || sessionStorage.getItem('dochazka_active_user_v2');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.userKey) activeUserKey = parsed.userKey;
            }
          } catch {
            // fallback na user:local
          }

          if (db.objectStoreNames.contains('days')) {
            const oldDaysStore = tx.objectStore('days');
            const newDaysStore = tx.objectStore('user_days');
            const getAllReq = oldDaysStore.getAll();

            getAllReq.onsuccess = () => {
              const oldRecords = getAllReq.result || [];
              for (const item of oldRecords) {
                if (item && item.date) {
                  newDaysStore.put({
                    userId: activeUserKey,
                    date: item.date,
                    type: item.type || 'work',
                    start: item.start || '',
                    end: item.end || '',
                    manualBreak: !!item.manualBreak,
                    breakMinutes: Number(item.breakMinutes) || 0,
                    doctorFullDay: !!item.doctorFullDay,
                    doctorStart: item.doctorStart || '',
                    doctorEnd: item.doctorEnd || '',
                    otherMinutes: Number(item.otherMinutes) || 0,
                    note: item.note || '',
                    updatedAt: item.updatedAt || new Date().toISOString()
                  });
                }
              }
            };
          }

          if (db.objectStoreNames.contains('settings')) {
            const oldSettingsStore = tx.objectStore('settings');
            const newSettingsStore = tx.objectStore('user_settings');
            const getSettingsReq = oldSettingsStore.get('settings');

            getSettingsReq.onsuccess = () => {
              const oldCfg = getSettingsReq.result;
              if (oldCfg) {
                newSettingsStore.put({
                  ...oldCfg,
                  userId: activeUserKey
                });
              }
            };
          }
        } catch (migErr) {
          console.error('Chyba při automatické migraci IndexedDB na v4:', migErr);
        }
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };

    req.onerror = () => reject(req.error);
  });
}

async function idbAction(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result = undefined;

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error(`IndexedDB transaction error na store "${storeName}".`));
    tx.onabort = () => reject(tx.error || new Error(`IndexedDB transaction abort na store "${storeName}".`));

    try {
      const request = callback(store, tx);
      if (request && 'onsuccess' in request) {
        request.onsuccess = () => {
          result = request.result;
          if (mode === 'readonly') resolve(result);
        };
        request.onerror = (e) => {
          e.stopPropagation?.();
          reject(request.error || new Error(`IndexedDB request error na store "${storeName}".`));
        };
      }
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // ignore abort errors
      }
      reject(err);
    }
  });
}

// ----------------------------------------------------------------------------
// DOCHÁZKA (user_days)
// ----------------------------------------------------------------------------

export async function getUserDays(userId) {
  return idbAction('user_days', 'readonly', (store) => {
    const index = store.index('userId');
    return index.getAll(IDBKeyRange.only(userId));
  });
}

export async function getUserDay(userId, date) {
  return idbAction('user_days', 'readonly', (store) => store.get([userId, date]));
}

export async function putUserDay(userId, day) {
  const record = {
    ...day,
    userId,
    updatedAt: day.updatedAt || new Date().toISOString()
  };
  await idbAction('user_days', 'readwrite', (store) => store.put(record));
  return record;
}

export async function deleteUserDay(userId, date) {
  return idbAction('user_days', 'readwrite', (store) => store.delete([userId, date]));
}

/**
 * Crash-safe attendance mutation: the local record and its pending remote action
 * share one IndexedDB readwrite transaction. A tab crash or quota error cannot
 * commit one without the other.
 */
async function commitAttendanceAndOutbox(userId, action, date, day, payload) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['user_days', 'sync_queue'], 'readwrite');
    let outboxId = null;
    tx.oncomplete = () => resolve(outboxId);
    tx.onerror = () => reject(tx.error || new Error('Uložení docházky a outboxu selhalo.'));
    tx.onabort = () => reject(tx.error || new Error('Transakce docházky byla zrušena.'));

    try {
      const dayStore = tx.objectStore('user_days');
      if (action === 'DELETE') {
        dayStore.delete([userId, date]);
      } else {
        dayStore.put({
          ...day,
          userId,
          updatedAt: day.updatedAt || new Date().toISOString()
        });
      }
      const queueRequest = tx.objectStore('sync_queue').add({
        userId,
        entity: 'attendance_days',
        action,
        payload,
        createdAt: new Date().toISOString(),
        retries: 0
      });
      queueRequest.onsuccess = () => { outboxId = queueRequest.result; };
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}

export function putUserDayWithOutbox(userId, day, payload) {
  return commitAttendanceAndOutbox(userId, 'UPSERT', day.date, day, payload);
}

export function deleteUserDayWithOutbox(userId, date, payload) {
  return commitAttendanceAndOutbox(userId, 'DELETE', date, null, payload);
}

export async function clearUserDays(userId) {
  const days = await getUserDays(userId);
  return idbAction('user_days', 'readwrite', (store) => {
    for (const d of days) store.delete([userId, d.date]);
  });
}

/**
 * Restore a validated backup as an atomic MERGE. Existing dates not present in
 * the backup are left untouched; every imported cloud change gets an outbox item
 * in the same transaction, so an interrupted restore can be retried safely.
 */
export function selectMissingBackupDays(days, existing, pending) {
  const protectedDates = new Set(existing.map(day => day.date));
  for (const item of pending) {
    if (item.entity === 'attendance_days' && item.payload?.date) protectedDates.add(item.payload.date);
  }
  return days.filter(day => !protectedDates.has(day.date));
}

export async function importUserBackupAtomic(userId, days, settings = null, queueActions = []) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['user_days', 'user_settings', 'sync_queue'], 'readwrite');
    let imported = 0;
    tx.oncomplete = () => resolve(imported);
    tx.onerror = () => reject(tx.error || new Error('Import zálohy selhal.'));
    tx.onabort = () => reject(tx.error || new Error('Import zálohy byl vrácen zpět.'));
    const daysStore = tx.objectStore('user_days');
    const queueStore = tx.objectStore('sync_queue');
    const localRequest = daysStore.index('userId').getAll(IDBKeyRange.only(userId));
    const queueRequest = queueStore.index('userId').getAll(IDBKeyRange.only(userId));
    let local;
    let pending;
    function commitWhenReady() {
      if (!local || !pending) return;
      try {
        const missing = selectMissingBackupDays(days, local, pending);
        const accepted = new Set(missing.map(day => day.date));
        for (const day of missing) daysStore.add({ ...day, userId });
        imported = missing.length;
        // The restore UI never replaces settings. Retain the optional argument
        // only for initializing an otherwise empty local account.
        if (settings && userId === 'user:local') {
          const store = tx.objectStore('user_settings');
          const request = store.get(userId);
          request.onsuccess = () => { if (!request.result) store.add({ ...settings, userId }); };
        }
        for (const action of queueActions) {
          if (action.entity !== 'attendance_days' || action.action !== 'IMPORT_MISSING' ||
              !accepted.has(action.payload?.date)) continue;
          queueStore.add({
            userId, entity: action.entity, action: action.action, payload: action.payload,
            createdAt: new Date().toISOString(), retries: 0
          });
        }
      } catch (err) {
        tx.abort();
        reject(err);
      }
    }
    localRequest.onsuccess = () => { local = localRequest.result || []; commitWhenReady(); };
    queueRequest.onsuccess = () => { pending = queueRequest.result || []; commitWhenReady(); };
  });
}

// ----------------------------------------------------------------------------
// NASTAVENÍ (user_settings)
// ----------------------------------------------------------------------------

export async function getUserSettings(userId) {
  const result = await idbAction('user_settings', 'readonly', (store) => store.get(userId));
  return result || null;
}

export async function putUserSettings(userId, settings) {
  const record = { ...settings, userId };
  await idbAction('user_settings', 'readwrite', (store) => store.put(record));
  return record;
}

/** Commit the profile and its durable cloud mutation together. */
export async function putUserSettingsWithOutbox(userId, settings, payload) {
  if (!userId || payload?.user_key !== userId) throw new Error('Neplatný účet nastavení.');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['user_settings', 'sync_queue'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Uložení nastavení selhalo.'));
    tx.onabort = () => reject(tx.error || new Error('Uložení nastavení bylo zrušeno.'));
    tx.objectStore('user_settings').put({ ...settings, userId });
    tx.objectStore('sync_queue').add({
      userId, entity: 'attendance_profiles', action: 'UPDATE', payload,
      createdAt: new Date().toISOString(), retries: 0
    });
  });
}

/** Protect pending edits even when a different tab saves during a cloud pull. */
export async function applyServerSettingsIfNoPending(userId, settings) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['user_settings', 'sync_queue'], 'readwrite');
    let applied = false;
    tx.oncomplete = () => resolve(applied);
    tx.onerror = () => reject(tx.error || new Error('Načtení nastavení selhalo.'));
    tx.onabort = () => reject(tx.error || new Error('Načtení nastavení bylo zrušeno.'));
    const request = tx.objectStore('sync_queue').index('userId').getAll(IDBKeyRange.only(userId));
    request.onsuccess = () => {
      if ((request.result || []).some(item => item.entity === 'attendance_profiles')) return;
      tx.objectStore('user_settings').put({ ...settings, userId });
      applied = true;
    };
  });
}

export async function deleteUserSettings(userId) {
  return idbAction('user_settings', 'readwrite', (store) => store.delete(userId));
}

// ----------------------------------------------------------------------------
// SYNC OUTBOX QUEUE (sync_queue)
// ----------------------------------------------------------------------------

export async function enqueueSyncAction(userId, entity, action, payload, { conflict = false, serverUpdatedAt = null } = {}) {
  const item = {
    userId,
    entity,
    action,
    payload,
    createdAt: new Date().toISOString(),
    retries: 0,
    ...(conflict ? { conflict: true, serverUpdatedAt } : {})
  };
  return idbAction('sync_queue', 'readwrite', (store) => store.add(item));
}

export async function getPendingSyncActions(userId) {
  return idbAction('sync_queue', 'readonly', (store) => {
    const index = store.index('userId');
    return index.getAll(IDBKeyRange.only(userId));
  });
}

export async function removeSyncAction(id) {
  return idbAction('sync_queue', 'readwrite', (store) => store.delete(id));
}

export async function updateSyncAction(item) {
  // An in-flight retry must not resurrect a queue item already acknowledged
  // or explicitly discarded by another operation.
  return idbAction('sync_queue', 'readwrite', (store) => {
    const request = store.get(item.id);
    request.onsuccess = () => {
      if (request.result && request.result.userId === item.userId) store.put(item);
    };
  });
}

export async function clearUserSyncQueue(userId) {
  const items = await getPendingSyncActions(userId);
  return idbAction('sync_queue', 'readwrite', (store) => {
    for (const item of items) {
      if (item?.id != null) store.delete(item.id);
    }
  });
}

/**
 * Bezpečnostní úklid po odhlášení: odstraní lokální cloudová data konkrétního
 * účtu. Při automatickém vypršení zachová jen neodeslané změny pro opětovné přihlášení.
 * Lokální anonymní profil `user:local` se tímto nemaže.
 */
export async function clearUserLocalData(userId, { preservePending = false } = {}) {
  if (!userId || userId === 'user:local') return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['user_days', 'user_settings', 'sync_queue'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Úklid lokálních dat selhal.'));
    tx.onabort = () => reject(tx.error || new Error('Úklid lokálních dat byl zrušen.'));

    const queue = tx.objectStore('sync_queue');
    const days = tx.objectStore('user_days');
    const pendingRequest = queue.index('userId').getAll(IDBKeyRange.only(userId));
    pendingRequest.onsuccess = () => {
      const pending = pendingRequest.result || [];
      const retained = pendingLocalData(pending, preservePending);
      if (!preservePending) {
        for (const item of pending) queue.delete(item.id);
      }
      if (!retained.settings) tx.objectStore('user_settings').delete(userId);
      const cursorRequest = days.index('userId').openCursor(IDBKeyRange.only(userId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (!retained.dates.has(cursor.value.date)) cursor.delete();
        cursor.continue();
      };
    };
  });
}

/** Keep only the local data needed to recover unconfirmed changes for the same account. */
export function pendingLocalData(pending, preservePending) {
  const dates = new Set();
  let settings = false;
  if (preservePending) {
    for (const item of pending) {
      if (item.entity === 'attendance_days' && item.payload?.date) dates.add(item.payload.date);
      if (item.entity === 'attendance_profiles') settings = true;
    }
  }
  return { dates, settings };
}


// Snapshot only the selected date and account. Reject changes made after review.
export function conflictQueueSnapshot(actions, userId, date) {
  return JSON.stringify(actions.filter(item => item.userId === userId &&
    item.entity === 'attendance_days' && item.payload?.date === date)
    .sort((a, b) => a.id - b.id));
}

/** Adopt a reviewed server version without touching another day or account. */
export async function acceptConflictServerVersion(userId, date, expectedQueue, expectedLocal, serverDay) {
  if (!userId || !serverDay || serverDay.date !== date) throw new Error('Neplatná cloudová verze.');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['user_days', 'sync_queue'], 'readwrite');
    let accepted = false;
    tx.oncomplete = () => resolve(accepted);
    tx.onerror = () => reject(tx.error || new Error('Převzetí cloudové verze selhalo.'));
    tx.onabort = () => reject(tx.error || new Error('Převzetí cloudové verze bylo přerušeno.'));
    const queue = tx.objectStore('sync_queue');
    const days = tx.objectStore('user_days');
    const pending = queue.index('userId').getAll(IDBKeyRange.only(userId));
    pending.onsuccess = () => {
      const actions = pending.result || [];
      const snapshot = conflictQueueSnapshot(actions, userId, date);
      const selected = JSON.parse(snapshot);
      if (snapshot !== expectedQueue || !selected.some(item => item.conflict)) return;
      const local = days.get([userId, date]);
      local.onsuccess = () => {
        if (JSON.stringify(local.result || null) !== expectedLocal) return;
        if (serverDay.deletedAt) days.delete([userId, date]);
        else days.put({ ...serverDay, userId });
        for (const item of selected) queue.delete(item.id);
        accepted = true;
      };
    };
  });
}
