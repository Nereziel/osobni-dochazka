import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSync, REALTIME_SYNC_DEBOUNCE_MS } from '../src/composables/useSync.js';
import * as syncService from '../src/services/sync.js';
import * as supabaseService from '../src/services/supabase.js';
import * as idbService from '../src/services/indexedDb.js';

describe('Realtime trailing debounce and sync serialization', () => {
  const currentUser = {
    userKey: 'user:martin',
    username: 'martin',
    pinHash: 'test_hash'
  };
  const currentSettings = { workStart: '06:30', workEnd: '15:30' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces multiple fast Realtime events into exactly 1 performFullSync call after 5 seconds', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });

    const { handleRealtimeEvent, unsubscribeRealtime } = useSync();

    // 0 s: Přijde 1. Realtime event (např. UPDATE)
    handleRealtimeEvent(currentUser, currentSettings);
    expect(syncSpy).not.toHaveBeenCalled();

    // 1 s: Posuneme čas o 1000 ms a přijde 2. Realtime event (např. UPDATE)
    vi.advanceTimersByTime(1000);
    handleRealtimeEvent(currentUser, currentSettings);
    expect(syncSpy).not.toHaveBeenCalled();

    // 3 s: Posuneme čas o 2000 ms a přijde 3. Realtime event (např. DELETE)
    vi.advanceTimersByTime(2000);
    handleRealtimeEvent(currentUser, currentSettings);
    expect(syncSpy).not.toHaveBeenCalled();

    // Posuneme o 4999 ms (stále neuplynulo celých 5 s od posledního eventu)
    vi.advanceTimersByTime(4999);
    expect(syncSpy).not.toHaveBeenCalled();

    // Posuneme o 1 ms -> uplynulo přesně 5000 ms od posledního eventu v čase 3 s (celkem čas 8 s)
    await vi.advanceTimersByTimeAsync(1);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledWith(currentUser, currentSettings, { pushLocalDays: false });

    unsubscribeRealtime();
  });

  it('queues a pending sync if a Realtime event arrives while sync is already in progress', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);

    let resolveSyncPromise;
    const pendingSyncPromise = new Promise((resolve) => {
      resolveSyncPromise = resolve;
    });

    const syncSpy = vi.spyOn(syncService, 'performFullSync')
      .mockImplementationOnce(() => pendingSyncPromise)
      .mockResolvedValueOnce({ status: 'online', recordsMap: new Map() });

    const { sync, handleRealtimeEvent, unsubscribeRealtime } = useSync();

    // 1. Spustíme manuální synchronizaci (která ještě běží)
    const activeSyncPromise = sync(currentUser, currentSettings);

    // 2. Během běžící synchronizace přijde Realtime event
    handleRealtimeEvent(currentUser, currentSettings);

    // Dokud první sync neskončí, druhý sync se nespustí (paralelní sync zakázán)
    expect(syncSpy).toHaveBeenCalledTimes(1);

    // 3. Dokončíme první synchronizaci
    resolveSyncPromise({ status: 'online', recordsMap: new Map() });
    await activeSyncPromise;

    // Po dokončení prvního syncu byl naplánován 5s debounce pro čekající Realtime event
    expect(syncSpy).toHaveBeenCalledTimes(1);

    // 4. Posuneme čas o 5 sekund
    await vi.advanceTimersByTimeAsync(REALTIME_SYNC_DEBOUNCE_MS);

    // Nyní proběhl přesně druhý sync
    expect(syncSpy).toHaveBeenCalledTimes(2);

    unsubscribeRealtime();
  });
});
