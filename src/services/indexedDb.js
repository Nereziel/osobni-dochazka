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

      // 1. Vytvoření nového per-user úložiště docházky
      if (!db.objectStoreNames.contains('user_days')) {
        const store = db.createObjectStore('user_days', { keyPath: ['userId', 'date'] });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 2. Vytvoření per-user nastavení
      if (!db.objectStoreNames.contains('user_settings')) {
        db.createObjectStore('user_settings', { keyPath: 'userId' });
      }

      // 3. Vytvoření perzistentní fronty synchronizace (outbox)
      if (!db.objectStoreNames.contains('sync_queue')) {
        const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        queueStore.createIndex('userId', 'userId', { unique: false });
        queueStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // 4. Migrace dat ze starých stores (v1/v2/v3: 'days' a 'settings')
      if (oldVersion > 0 && oldVersion < 4) {
        try {
          // Zjistíme, zda existoval přihlášený uživatel v localStorage
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

          // Převedení 'days' -> 'user_days'
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

          // Převedení 'settings' -> 'user_settings'
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

/**
 * Pomocné volání IDB transakce.
 * Zápis je považován za úspěšný až při tx.oncomplete (skutečný commit na disk).
 * Správně zachycuje request error, transaction error i transaction abort.
 */
async function idbAction(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result = undefined;

    tx.oncomplete = () => {
      resolve(result);
    };

    tx.onerror = () => {
      reject(tx.error || new Error(`IndexedDB transaction error na store "${storeName}".`));
    };

    tx.onabort = () => {
      reject(tx.error || new Error(`IndexedDB transaction abort na store "${storeName}".`));
    };

    try {
      const request = callback(store, tx);
      if (request && 'onsuccess' in request) {
        request.onsuccess = () => {
          result = request.result;
          // U readonly transakce resolveujeme rovnou po onsuccess pro rychlost,
          // ale u readwrite čekáme na tx.oncomplete pro potvrzení commitu
          if (mode === 'readonly') {
            resolve(result);
          }
        };
        request.onerror = (e) => {
          // Zabráníme nekontrolovanému bublání, tx.onerror zachytí chybu
          e.stopPropagation?.();
          reject(request.error || new Error(`IndexedDB request error na store "${storeName}".`));
        };
      }
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // Ignorujeme případný abort error
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
  return idbAction('user_days', 'readonly', (store) => {
    return store.get([userId, date]);
  });
}

export async function putUserDay(userId, day) {
  const record = {
    ...day,
    userId,
    updatedAt: day.updatedAt || new Date().toISOString()
  };
  await idbAction('user_days', 'readwrite', (store) => {
    return store.put(record);
  });
  return record;
}

export async function deleteUserDay(userId, date) {
  return idbAction('user_days', 'readwrite', (store) => {
    return store.delete([userId, date]);
  });
}

export async function clearUserDays(userId) {
  const days = await getUserDays(userId);
  return idbAction('user_days', 'readwrite', (store) => {
    for (const d of days) {
      store.delete([userId, d.date]);
    }
  });
}

// ----------------------------------------------------------------------------
// NASTAVENÍ (user_settings)
// ----------------------------------------------------------------------------

export async function getUserSettings(userId) {
  const result = await idbAction('user_settings', 'readonly', (store) => {
    return store.get(userId);
  });
  return result || null;
}

export async function putUserSettings(userId, settings) {
  const record = {
    ...settings,
    userId
  };
  await idbAction('user_settings', 'readwrite', (store) => {
    return store.put(record);
  });
  return record;
}

// ----------------------------------------------------------------------------
// SYNC OUTBOX QUEUE (sync_queue)
// ----------------------------------------------------------------------------

export async function enqueueSyncAction(userId, entity, action, payload) {
  const item = {
    userId,
    entity, // 'attendance_days' | 'attendance_profiles'
    action, // 'INSERT' | 'UPDATE' | 'UPSERT' | 'DELETE'
    payload,
    createdAt: new Date().toISOString(),
    retries: 0
  };
  return idbAction('sync_queue', 'readwrite', (store) => {
    return store.add(item);
  });
}

export async function getPendingSyncActions(userId) {
  return idbAction('sync_queue', 'readonly', (store) => {
    const index = store.index('userId');
    return index.getAll(IDBKeyRange.only(userId));
  });
}

export async function removeSyncAction(id) {
  return idbAction('sync_queue', 'readwrite', (store) => {
    return store.delete(id);
  });
}

export async function updateSyncAction(item) {
  return idbAction('sync_queue', 'readwrite', (store) => {
    return store.put(item);
  });
}

