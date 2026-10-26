import { ref } from 'vue';
import { performFullSync } from '../services/sync.js';
import { getPendingSyncActions } from '../services/indexedDb.js';
import { isSupabaseConfigured, getSupabaseClient } from '../services/supabase.js';

export const REALTIME_SYNC_DEBOUNCE_MS = 5000;

const syncState = ref('local'); // 'local' | 'online' | 'syncing' | 'error'
const syncError = ref(null);
const pendingCount = ref(0);

// Proměnné pro řízení Realtime trailing debounce a serializace synchronizace
let syncInProgress = false;
let pendingRealtimeSync = false;
let realtimeDebounceTimer = null;
let realtimeChannel = null;
let activeSubscriptionUserKey = null;
let onSyncCompletedCallback = null;

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
   * Spustí nebo restartuje 5s trailing debounce timer pro Realtime synchronizaci
   */
  function scheduleRealtimeDebounce(currentUser, currentSettings) {
    if (realtimeDebounceTimer) {
      clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = null;
    }

    realtimeDebounceTimer = setTimeout(async () => {
      realtimeDebounceTimer = null;

      if (syncInProgress) {
        // Pokud již běží jiná synchronizace, označíme příznak a počkáme na její dokončení
        pendingRealtimeSync = true;
        return;
      }

      try {
        const res = await sync(currentUser, currentSettings, { pushLocalDays: false });
        if (typeof onSyncCompletedCallback === 'function' && res?.recordsMap) {
          onSyncCompletedCallback(res.recordsMap);
        }
      } catch (err) {
        console.warn('Automatická Realtime synchronizace selhala:', err);
      }
    }, REALTIME_SYNC_DEBOUNCE_MS);
  }

  /**
   * Zpracování Realtime eventu z Postgresu:
   * Event restartuje 5s trailing debounce. Pokud právě běží sync, nastaví pending příznak.
   */
  function handleRealtimeEvent(currentUser, currentSettings) {
    if (syncInProgress) {
      pendingRealtimeSync = true;
      return;
    }
    scheduleRealtimeDebounce(currentUser, currentSettings);
  }

  /**
   * Hlavní synchronizace:
   * Zajišťuje, že neběží dvě plné synchronizace paralelně (syncInProgress).
   * Po dokončení zkontroluje, zda během běhu nepřišel Realtime event (pendingRealtimeSync).
   */
  async function sync(currentUser, currentSettings, options = { pushLocalDays: true }) {
    if (!isSupabaseConfigured() || !currentUser?.userKey) {
      syncState.value = isSupabaseConfigured() ? 'online' : 'local';
      return { status: 'local' };
    }

    if (syncInProgress) {
      // Pokud již synchronizace probíhá, zaznamenáme požadavek a vyčkáme
      pendingRealtimeSync = true;
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

      // Pokud během synchronizace dorazil další Realtime event,
      // po dokončení běžícího syncu znovu spustíme 5s trailing debounce
      if (pendingRealtimeSync) {
        pendingRealtimeSync = false;
        scheduleRealtimeDebounce(currentUser, currentSettings);
      }
    }
  }

  /**
   * Přihlášení k odběru Supabase Realtime změn tabulky attendance_days pro přihlášeného uživatele
   */
  function subscribeRealtime(currentUser, currentSettings, onRecordsUpdated) {
    if (typeof onRecordsUpdated === 'function') {
      onSyncCompletedCallback = onRecordsUpdated;
    }

    if (!isSupabaseConfigured() || !currentUser?.userKey) {
      unsubscribeRealtime();
      return;
    }

    // Pokud již odběr pro tohoto uživatele běží, znovu ho nezakládáme
    if (realtimeChannel && activeSubscriptionUserKey === currentUser.userKey) {
      return;
    }

    unsubscribeRealtime();

    const client = getSupabaseClient();
    if (!client) return;

    activeSubscriptionUserKey = currentUser.userKey;
    const channelName = `attendance_days_${currentUser.userKey.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    realtimeChannel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_days',
          filter: `user_key=eq.${currentUser.userKey}`
        },
        (_payload) => {
          handleRealtimeEvent(currentUser, currentSettings);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Odběr úspěšně aktivován
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('Realtime kanál zaznamenal chybu připojení');
        }
      });
  }

  /**
   * Zrušení odběru a vyčištění časovačů
   */
  function unsubscribeRealtime() {
    if (realtimeDebounceTimer) {
      clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = null;
    }
    pendingRealtimeSync = false;

    if (realtimeChannel) {
      const client = getSupabaseClient();
      client?.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    activeSubscriptionUserKey = null;
  }

  return {
    syncState,
    syncError,
    pendingCount,
    refreshPendingCount,
    sync,
    subscribeRealtime,
    unsubscribeRealtime,
    handleRealtimeEvent,
    scheduleRealtimeDebounce
  };
}
