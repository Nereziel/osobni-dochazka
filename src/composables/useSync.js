import { ref } from 'vue';
import { performFullSync } from '../services/sync.js';
import { getPendingSyncActions } from '../services/indexedDb.js';
import { isSupabaseConfigured } from '../services/supabase.js';

export const FOREGROUND_SYNC_INTERVAL_MS = 5000;

const syncState = ref('local'); // 'local' | 'online' | 'syncing' | 'error'
const syncError = ref(null);
const pendingCount = ref(0);

// Řízení synchronizace a 5s foreground pollingu
let syncInProgress = false;
let pendingFollowupSync = false;
let pollingTimer = null;
let activeUser = null;
let activeSettings = null;
let onSyncCompletedCallback = null;
let listenersAttached = false;

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
      const res = await sync(activeUser, activeSettings, { pushLocalDays: false });
      if (typeof onSyncCompletedCallback === 'function' && res?.recordsMap) {
        onSyncCompletedCallback(res.recordsMap);
      }
    } catch (err) {
      console.warn('Periodická 5s synchronizace selhala:', err);
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
        // Okamžitá synchronizace při návratu do foreground a restart 5s intervalu
        triggerPeriodicSync();
        startPollingTimer();
      }
    } else {
      // Pozastavit polling, pokud je aplikace na pozadí
      stopPollingTimer();
    }
  }

  function onOnline() {
    // Obnova online stavu -> okamžitý full sync
    if (activeUser?.userKey) {
      sync(activeUser, activeSettings, { pushLocalDays: true }).catch(() => {});
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
   * Zahájení 5s pollingu v popředí
   */
  function startForegroundSync(currentUser, currentSettings, onRecordsUpdated) {
    activeUser = currentUser;
    activeSettings = currentSettings;

    if (typeof onRecordsUpdated === 'function') {
      onSyncCompletedCallback = onRecordsUpdated;
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
   * Zastavení 5s pollingu a úklid
   */
  function stopForegroundSync() {
    stopPollingTimer();
    activeUser = null;
    activeSettings = null;
    onSyncCompletedCallback = null;

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
  async function sync(currentUser, currentSettings, options = { pushLocalDays: true }) {
    if (!isSupabaseConfigured() || !currentUser?.userKey) {
      syncState.value = isSupabaseConfigured() ? 'online' : 'local';
      return { status: 'local' };
    }

    if (syncInProgress) {
      pendingFollowupSync = true;
      return { status: 'syncing' };
    }

    syncInProgress = true;
    syncState.value = 'syncing';
    syncError.value = null;

    try {
      const result = await performFullSync(currentUser, currentSettings, options);
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
          sync(currentUser, currentSettings, { pushLocalDays: false }).catch(() => {});
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
    triggerPeriodicSync
  };
}
