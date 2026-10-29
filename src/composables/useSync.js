import { ref } from 'vue';
import { performFullSync, resetUserSyncCursor } from '../services/sync.js';
import { getPendingSyncActions, clearUserDays } from '../services/indexedDb.js';
import { isSupabaseConfigured } from '../services/supabase.js';

const rawEnvInterval = typeof import.meta !== 'undefined' && import.meta?.env?.VITE_SYNC_INTERVAL_MS
  ? Number(import.meta.env.VITE_SYNC_INTERVAL_MS)
  : (typeof process !== 'undefined' && process?.env?.VITE_SYNC_INTERVAL_MS ? Number(process.env.VITE_SYNC_INTERVAL_MS) : NaN);

export const FOREGROUND_SYNC_INTERVAL_MS = !Number.isNaN(rawEnvInterval) && rawEnvInterval > 0
  ? rawEnvInterval
  : 10000;

export const SESSION_VERIFY_INTERVAL_MS = 300000; // 5 minut – lehké periodické ověření platnosti session
export const BOOT_SYNC_SKIP_COOLDOWN_MS = 15000; // 15 sekund – ochrana proti F5 datovému syncu (nikdy nepřeskakuje verifySession!)
export const BOOT_INCREMENTAL_WINDOW_MS = 300000; // 5 minut – okno pro lehký inkrementální sync po reloadu

const bootSyncTimestamps = new Map();

export function getBootSyncTimestamp(userKey) {
  if (!userKey) return 0;
  if (bootSyncTimestamps.has(userKey)) {
    return bootSyncTimestamps.get(userKey);
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = Number(sessionStorage.getItem(`dochazka_boot_sync_ts_${userKey}`) || 0);
      if (stored > 0) {
        bootSyncTimestamps.set(userKey, stored);
        return stored;
      }
    }
  } catch {
    // ignore storage errors
  }
  return 0;
}

export function setBootSyncTimestamp(userKey, ts = Date.now()) {
  if (!userKey) return;
  if (ts && ts > 0) {
    bootSyncTimestamps.set(userKey, ts);
  } else {
    bootSyncTimestamps.delete(userKey);
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (ts && ts > 0) {
        sessionStorage.setItem(`dochazka_boot_sync_ts_${userKey}`, String(ts));
      } else {
        sessionStorage.removeItem(`dochazka_boot_sync_ts_${userKey}`);
      }
    }
  } catch {
    // ignore storage errors
  }
}

const syncState = ref('local'); // 'local' | 'online' | 'syncing' | 'error'
const syncError = ref(null);
const pendingCount = ref(0);

// Řízení synchronizace a 10s foreground pollingu + 5min ověření session
let syncInProgress = false;
let pendingFollowupOptions = null;
let pollingTimer = null;
let sessionVerifyTimer = null;
let activeUser = null;
let activeSettings = null;
let onSyncCompletedCallback = null;
let onVerifySessionCallback = null;
let onInvalidSessionCallback = null;
let listenersAttached = false;
let lastVisibilitySyncAt = 0;
let lastSessionVerifyAt = 0;

function mergeFollowupOptions(existing, incoming) {
  if (!existing) {
    return { ...incoming };
  }
  return {
    pushLocalDays: Boolean(existing.pushLocalDays || incoming.pushLocalDays),
    incremental: Boolean(existing.incremental && incoming.incremental),
    fetchProfile: Boolean(existing.fetchProfile || incoming.fetchProfile)
  };
}

function getActiveSettings() {
  if (typeof activeSettings === 'function') {
    return activeSettings();
  }
  if (activeSettings && typeof activeSettings === 'object' && 'value' in activeSettings) {
    return activeSettings.value;
  }
  return activeSettings;
}

export function useSync() {
  async function refreshPendingCount(userId) {
    if (!userId) {
      pendingCount.value = 0;
      return 0;
    }
    const actions = await getPendingSyncActions(userId);
    pendingCount.value = actions?.length || 0;
    return pendingCount.value;
  }

  /**
   * Lehké periodické ověření platnosti session (každých 5 minut v popředí)
   */
  async function triggerPeriodicSessionVerify() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      stopPollingTimer();
      return true;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      stopPollingTimer();
      return true;
    }
    if (!activeUser?.userKey || !isSupabaseConfigured()) {
      stopPollingTimer();
      return true;
    }
    if (typeof onVerifySessionCallback !== 'function') {
      return true;
    }

    try {
      const isValid = await onVerifySessionCallback();
      if (!isValid) {
        stopPollingTimer();
        if (typeof onInvalidSessionCallback === 'function') {
          onInvalidSessionCallback();
        }
        return false;
      }
      lastSessionVerifyAt = Date.now();
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Spustí jeden krok lehkého foreground syncu (každých 10 sekund, bez volání verifySession)
   */
  async function triggerPeriodicSync() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      stopPollingTimer();
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      stopPollingTimer();
      return;
    }
    if (!activeUser?.userKey || !isSupabaseConfigured()) {
      stopPollingTimer();
      return;
    }

    try {
      const res = await sync(activeUser, getActiveSettings(), {
        pushLocalDays: false,
        incremental: true,
        fetchProfile: false
      });
      if (typeof onSyncCompletedCallback === 'function' && res?.recordsMap) {
        onSyncCompletedCallback(res.recordsMap, res.serverProfile);
      }
    } catch (err) {
      console.warn('Periodická 10s synchronizace selhala:', err);
    }
  }

  function scheduleSessionVerifyTimer() {
    if (sessionVerifyTimer) {
      clearTimeout(sessionVerifyTimer);
      sessionVerifyTimer = null;
    }
    const now = Date.now();
    const elapsed = lastSessionVerifyAt > 0 ? now - lastSessionVerifyAt : 0;
    const remaining = Math.max(0, SESSION_VERIFY_INTERVAL_MS - elapsed);

    sessionVerifyTimer = setTimeout(async () => {
      sessionVerifyTimer = null;
      const isValid = await triggerPeriodicSessionVerify();
      if (isValid && activeUser?.userKey && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
        scheduleSessionVerifyTimer();
      }
    }, remaining);
  }

  function startPollingTimer() {
    stopPollingTimer();
    pollingTimer = setInterval(() => {
      triggerPeriodicSync();
    }, FOREGROUND_SYNC_INTERVAL_MS);

    scheduleSessionVerifyTimer();
  }

  function stopPollingTimer() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    if (sessionVerifyTimer) {
      clearTimeout(sessionVerifyTimer);
      sessionVerifyTimer = null;
    }
  }

  async function handleForegroundResume() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!activeUser?.userKey || !isSupabaseConfigured()) return;

    const now = Date.now();
    // Pokud od posledního ověření session uplynulo >= 5 minut, provedeme verifySession() okamžitě
    if (lastSessionVerifyAt > 0 && now - lastSessionVerifyAt >= SESSION_VERIFY_INTERVAL_MS) {
      const isValid = await triggerPeriodicSessionVerify();
      if (!isValid) {
        return;
      }
    }

    // Ochrana proti rychlému přepínání oken/tabů – minimální odstup 3s pro datový sync
    if (Date.now() - lastVisibilitySyncAt >= 3000) {
      lastVisibilitySyncAt = Date.now();
      triggerPeriodicSync();
    }
    startPollingTimer();
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      handleForegroundResume();
    } else {
      // Pozastavit polling, pokud je aplikace na pozadí
      stopPollingTimer();
    }
  }

  function onWindowFocus() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!activeUser?.userKey || !isSupabaseConfigured()) return;

    const now = Date.now();
    if (lastSessionVerifyAt > 0 && now - lastSessionVerifyAt >= SESSION_VERIFY_INTERVAL_MS) {
      triggerPeriodicSessionVerify().then((isValid) => {
        if (isValid && activeUser?.userKey) {
          scheduleSessionVerifyTimer();
        }
      });
    }
  }

  async function onOnline() {
    // Jednotný reconnect flow:
    // online -> verifySession -> pokud validní: full sync pushLocalDays=true -> resume periodic polling
    //                            pokud nevalidní: logout / login
    if (activeUser?.userKey) {
      if (typeof onVerifySessionCallback === 'function') {
        const isValid = await onVerifySessionCallback();
        if (!isValid) {
          stopPollingTimer();
          if (typeof onInvalidSessionCallback === 'function') {
            onInvalidSessionCallback();
          }
          return;
        }
        lastSessionVerifyAt = Date.now();
      }

      try {
        const res = await sync(activeUser, getActiveSettings(), {
          pushLocalDays: true,
          incremental: false,
          fetchProfile: true
        });
        if (typeof onSyncCompletedCallback === 'function' && res?.recordsMap) {
          onSyncCompletedCallback(res.recordsMap, res.serverProfile);
        }
      } catch (err) {
        console.warn('Reconnect full sync selhal:', err);
      }
    }

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      startPollingTimer();
    }
  }

  function onOffline() {
    stopPollingTimer();
    syncState.value = 'local';
  }

  /**
   * Zahájení periodického pollingu v popředí
   */
  function startForegroundSync(currentUser, currentSettings, onRecordsUpdated, options = {}) {
    activeUser = currentUser;
    activeSettings = currentSettings;

    if (typeof onRecordsUpdated === 'function') {
      onSyncCompletedCallback = onRecordsUpdated;
    }
    if (typeof options?.onVerifySession === 'function') {
      onVerifySessionCallback = options.onVerifySession;
    }
    if (typeof options?.onInvalidSession === 'function') {
      onInvalidSessionCallback = options.onInvalidSession;
    }

    if (!isSupabaseConfigured() || !currentUser?.userKey) {
      stopForegroundSync();
      return;
    }

    if (lastSessionVerifyAt === 0) {
      lastSessionVerifyAt = Date.now();
    }

    if (!listenersAttached && typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onWindowFocus);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      listenersAttached = true;
    }

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      if (syncState.value === 'local' && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        syncState.value = 'online';
      }
      startPollingTimer();
    }
  }

  /**
   * Zastavení periodického pollingu a úklid
   */
  function stopForegroundSync() {
    stopPollingTimer();
    activeUser = null;
    activeSettings = null;
    onSyncCompletedCallback = null;
    onVerifySessionCallback = null;
    onInvalidSessionCallback = null;
    lastVisibilitySyncAt = 0;
    lastSessionVerifyAt = 0;
    pendingFollowupOptions = null;

    if (listenersAttached && typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      listenersAttached = false;
    }
  }

  /**
   * Hlavní synchronizace:
   * Zajišťuje, že neběží dvě plné synchronizace paralelně (syncInProgress).
   */
  async function sync(currentUser, currentSettings, options = {}) {
    if (!isSupabaseConfigured() || !currentUser?.userKey) {
      syncState.value = isSupabaseConfigured() ? 'online' : 'local';
      return { status: 'local' };
    }

    const syncOptions = {
      pushLocalDays: true,
      incremental: false,
      fetchProfile: true,
      ...options
    };

    if (syncInProgress) {
      pendingFollowupOptions = mergeFollowupOptions(pendingFollowupOptions, syncOptions);
      return { status: 'syncing' };
    }

    syncInProgress = true;
    syncState.value = 'syncing';
    syncError.value = null;

    const resolvedSettings = (
      typeof currentSettings === 'function'
        ? currentSettings()
        : (currentSettings && typeof currentSettings === 'object' && 'value' in currentSettings ? currentSettings.value : currentSettings)
    ) || getActiveSettings();

    try {
      const result = await performFullSync(currentUser, resolvedSettings, syncOptions);
      syncState.value = 'online';
      await refreshPendingCount(currentUser.userKey);
      return result;
    } catch (err) {
      console.error('Chyba synchronizace:', err);
      syncState.value = 'error';
      syncError.value = err.message || 'Chyba synchronizace se Supabase';
      await refreshPendingCount(currentUser.userKey);
      throw err;
    } finally {
      syncInProgress = false;

      if (pendingFollowupOptions) {
        const nextOptions = pendingFollowupOptions;
        pendingFollowupOptions = null;
        setTimeout(() => {
          sync(currentUser, getActiveSettings(), nextOptions)
            .then((res) => {
              if (typeof onSyncCompletedCallback === 'function' && res?.recordsMap) {
                onSyncCompletedCallback(res.recordsMap, res.serverProfile);
              }
            })
            .catch(() => {});
        }, 50);
      }
    }
  }

  /**
   * Jednotný startovací (boot/reload) flow pro přihlášeného uživatele:
   * 1. VŽDY nejprve provede verifySession() – ochrana proti F5 nikdy nepřeskakuje ověření session.
   * 2. Při neplatné session okamžitě provede tichý lokální logout bez confirmu a otevře login modal.
   * 3. Teprve po úspěšném ověření session rozhodne, zda:
   *    - přeskočit okamžitý datový sync (< 15 s od posledního syncu a prázdný outbox),
   *    - provést incremental sync (< 5 min od posledního syncu a prázdný outbox),
   *    - provést full sync.
   */
  async function runBootSyncFlow({
    currentUser,
    settingsGetter,
    verifySessionFn,
    onInvalidSessionFn,
    onSyncCompletedFn,
    triggerFullSyncFn,
    startServiceFn
  }) {
    if (!isSupabaseConfigured() || !currentUser?.userKey) {
      return { verified: false, mode: 'none' };
    }

    const isValid = await verifySessionFn();
    if (!isValid) {
      stopForegroundSync();
      if (typeof onInvalidSessionFn === 'function') {
        onInvalidSessionFn();
      }
      return { verified: false, mode: 'invalid_session' };
    }
    lastSessionVerifyAt = Date.now();

    const userKey = currentUser.userKey;
    const now = Date.now();
    const lastBootSync = getBootSyncTimestamp(userKey);
    const elapsedSinceLastBoot = lastBootSync > 0 ? now - lastBootSync : Infinity;
    await refreshPendingCount(userKey);

    let mode = 'full';
    if (elapsedSinceLastBoot < BOOT_SYNC_SKIP_COOLDOWN_MS && pendingCount.value === 0) {
      mode = 'skip';
    } else if (elapsedSinceLastBoot < BOOT_INCREMENTAL_WINDOW_MS && pendingCount.value === 0) {
      mode = 'incremental';
      const res = await sync(currentUser, settingsGetter, {
        pushLocalDays: false,
        incremental: true,
        fetchProfile: false
      });
      if (typeof onSyncCompletedFn === 'function' && res) {
        await onSyncCompletedFn(res.recordsMap, res.serverProfile);
      }
      setBootSyncTimestamp(userKey, Date.now());
    } else {
      mode = 'full';
      if (typeof triggerFullSyncFn === 'function') {
        await triggerFullSyncFn();
      } else {
        const res = await sync(currentUser, settingsGetter, {
          pushLocalDays: false,
          incremental: false,
          fetchProfile: true
        });
        if (typeof onSyncCompletedFn === 'function' && res) {
          await onSyncCompletedFn(res.recordsMap, res.serverProfile);
        }
        setBootSyncTimestamp(userKey, Date.now());
      }
    }

    if (typeof startServiceFn === 'function') {
      startServiceFn();
    }

    return { verified: true, mode };
  }

  /**
   * Reset lokálních dat docházky:
   * - smaže lokální attendance dny v IndexedDB,
   * - vymaže inkrementální synchronizační kurzor (lastSuccessfulPullAt) i boot timestamp,
   * - pokud je uživatel online a přihlášený, následně provede full pull ze serveru.
   */
  async function runResetLocalDataFlow({
    currentUser,
    settingsGetter,
    loadRecordsFn,
    onSyncCompletedFn
  }) {
    const userKey = currentUser?.userKey || 'user:local';
    await clearUserDays(userKey);
    resetUserSyncCursor(userKey);
    setBootSyncTimestamp(userKey, 0);

    if (typeof loadRecordsFn === 'function') {
      await loadRecordsFn(userKey);
    }

    if (isSupabaseConfigured() && currentUser?.userKey && (typeof navigator === 'undefined' || navigator.onLine)) {
      const res = await sync(currentUser, settingsGetter, {
        pushLocalDays: false,
        incremental: false,
        fetchProfile: true
      });
      if (typeof onSyncCompletedFn === 'function' && res) {
        await onSyncCompletedFn(res.recordsMap, res.serverProfile);
      }
      setBootSyncTimestamp(userKey, Date.now());
      return { status: 'pulled', result: res };
    }

    return { status: 'cleared' };
  }

  return {
    syncState,
    syncError,
    pendingCount,
    refreshPendingCount,
    sync,
    startForegroundSync,
    stopForegroundSync,
    triggerPeriodicSync,
    triggerPeriodicSessionVerify,
    runBootSyncFlow,
    runResetLocalDataFlow
  };
}
