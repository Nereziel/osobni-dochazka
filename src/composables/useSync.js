import { ref, computed } from 'vue';
import { performFullSync, drainOutboxQueue } from '../services/sync.js';
import { getPendingSyncActions } from '../services/indexedDb.js';
import { isSupabaseConfigured } from '../services/supabase.js';

const syncState = ref('local'); // 'local' | 'online' | 'syncing' | 'error'
const syncError = ref(null);
const pendingCount = ref(0);

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

  async function sync(currentUser, currentSettings, options = { pushLocalDays: true }) {
    if (!isSupabaseConfigured() || !currentUser?.userKey) {
      syncState.value = isSupabaseConfigured() ? 'online' : 'local';
      return { status: 'local' };
    }

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
    }
  }

  return {
    syncState,
    syncError,
    pendingCount,
    refreshPendingCount,
    sync
  };
}

