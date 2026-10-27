import { ref } from 'vue';
import { performFullSync } from '../services/sync.js';
import { getPendingSyncActions } from '../services/indexedDb.js';
import { isSupabaseConfigured } from '../services/supabase.js';

const rawEnvInterval = typeof import.meta !== 'undefined' && import.meta?.env?.VITE_SYNC_INTERVAL_MS
  ? Number(import.meta.env.VITE_SYNC_INTERVAL_MS)
  : (typeof process !== 'undefined' && process?.env?.VITE_SYNC_INTERVAL_MS ? Number(process.env.VITE_SYNC_INTERVAL_MS) : NaN);

export const FOREGROUND_SYNC_INTERVAL_MS = !Number.isNaN(rawEnvInterval) && rawEnvInterval > 0
  ? rawEnvInterval
  : 10000;

const syncState = ref('local'); // 'local' | 'online' | 'syncing' | 'error'
const syncError = ref(null);
const pendingCount = ref(0);

// Řízení synchronizace a 10s foreground pollingu
let syncInProgress = false;
let pendingFollowupSync = false;
let pollingTimer = null;
let activeUser = null;
let activeSettings = null;
let onSyncCompletedCallback = null;
let onVerifySessionCallback = null;
let onInvalidSessionCallback = null;
let listenersAttached = false;

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
  function updateSyncSettings(newSettings) {
    activeSettings = newSettings;
  }

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
   * Spustí jeden krok lehkého foreground syncu
   */
  async function triggerPeriodicSync() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      stopPollingTimer();
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
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

  function startPollingTimer() {
    stopPollingTimer();
    pollingTimer = setInterval(() => {
      triggerPeriodicSync();
    }, FOREGROUND_SYNC_INTERVAL_MS);
  }

  function stopPollingTimer() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        // Okamžitá synchronizace při návratu do foreground a restart 10s intervalu
        triggerPeriodicSync();
        startPollingTimer();
      }
    } else {
      // Pozastavit polling, pokud je aplikace na pozadí
      stopPollingTimer();
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

    if (!listenersAttached && typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      listenersAttached = true;
    }

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
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

    if (listenersAttached && typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
      pendingFollowupSync = true;
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

      if (pendingFollowupSync) {
        pendingFollowupSync = false;
        setTimeout(() => {
          sync(currentUser, getActiveSettings(), { pushLocalDays: false }).catch(() => {});
        }, 50);
      }
    }
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
    updateSyncSettings
  };
}
