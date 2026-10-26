import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSync, FOREGROUND_SYNC_INTERVAL_MS } from '../src/composables/useSync.js';
import * as syncService from '../src/services/sync.js';
import * as supabaseService from '../src/services/supabase.js';
import * as idbService from '../src/services/indexedDb.js';

class MockEventTarget {
  constructor() {
    this.listeners = {};
  }
  addEventListener(type, cb) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  removeEventListener(type, cb) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(l => l !== cb);
    }
  }
  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    if (this.listeners[type]) {
      this.listeners[type].forEach(cb => cb(event));
    }
  }
}

describe('Foreground 5s periodic sync, visibility and serialization', () => {
  const currentUser = {
    userKey: 'user:martin',
    username: 'martin',
    sessionToken: 'test_session_token_123'
  };
  const currentSettings = { workStart: '06:30', workEnd: '15:30' };

  let origDoc;
  let origWin;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([]);
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);

    origDoc = globalThis.document;
    origWin = globalThis.window;

    const mockDoc = new MockEventTarget();
    mockDoc.visibilityState = 'visible';
    globalThis.document = mockDoc;

    const mockWin = new MockEventTarget();
    globalThis.window = mockWin;

    try {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true
      });
    } catch {
      // fallback
    }
  });

  afterEach(() => {
    const { stopForegroundSync } = useSync();
    stopForegroundSync();
    vi.useRealTimers();

    globalThis.document = origDoc;
    globalThis.window = origWin;
  });

  it('runs periodic sync every 10 seconds when visible and online', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, currentSettings);

    expect(syncSpy).not.toHaveBeenCalled();

    // Po 10 sekundách proběhne 1. periodický sync
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledWith(currentUser, currentSettings, {
      pushLocalDays: false,
      incremental: true,
      fetchProfile: false
    });

    // Po dalších 10 sekundách proběhne 2. periodický sync
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    expect(syncSpy).toHaveBeenCalledTimes(2);

    stopForegroundSync();
  });

  it('pauses 10s periodic sync when document becomes hidden, resumes on visible', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, currentSettings);

    // Přepneme aplikaci do pozadí
    globalThis.document.visibilityState = 'hidden';
    globalThis.document.dispatchEvent({ type: 'visibilitychange' });

    // Uplyne 20 sekund na pozadí -> žádný sync neproběhne
    await vi.advanceTimersByTimeAsync(20000);
    expect(syncSpy).not.toHaveBeenCalled();

    // Návrat do popředí -> okamžitý sync a obnova intervalu
    globalThis.document.visibilityState = 'visible';
    globalThis.document.dispatchEvent({ type: 'visibilitychange' });

    // Okamžitý sync po návratu do foreground
    expect(syncSpy).toHaveBeenCalledTimes(1);

    // Po dalších 10 s proběhne další tick
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    expect(syncSpy).toHaveBeenCalledTimes(2);

    stopForegroundSync();
  });

  it('queues a pending sync if a timer triggers while sync is already in progress', async () => {
    let resolveSyncPromise;
    const pendingSyncPromise = new Promise((resolve) => {
      resolveSyncPromise = resolve;
    });

    const syncSpy = vi.spyOn(syncService, 'performFullSync')
      .mockImplementationOnce(() => pendingSyncPromise)
      .mockResolvedValueOnce({ status: 'online', recordsMap: new Map() });

    const { sync, startForegroundSync, triggerPeriodicSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, currentSettings);

    // 1. Spustíme synchronizaci (která čeká na resolveSyncPromise)
    const activeSyncPromise = sync(currentUser, currentSettings);
    expect(syncSpy).toHaveBeenCalledTimes(1);

    // 2. Během běžící synchronizace dorazí periodický trigger
    await triggerPeriodicSync();

    // Paralelní sync se nespustil
    expect(syncSpy).toHaveBeenCalledTimes(1);

    // 3. Dokončíme první synchronizaci
    resolveSyncPromise({ status: 'online', recordsMap: new Map() });
    await activeSyncPromise;

    // 4. Posuneme čas pro zpracování naplánovaného následného syncu (50ms timeout)
    await vi.advanceTimersByTimeAsync(100);

    // Nyní proběhla druhá návazná synchronizace
    expect(syncSpy).toHaveBeenCalledTimes(2);

    stopForegroundSync();
  });

  it('immediately triggers full sync on window online event', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, currentSettings);

    // Simulace online události
    globalThis.window.dispatchEvent({ type: 'online' });

    expect(syncSpy).toHaveBeenCalledWith(currentUser, currentSettings, {
      pushLocalDays: true,
      incremental: false,
      fetchProfile: true
    });

    stopForegroundSync();
  });
});

