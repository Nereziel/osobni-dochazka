import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useSync,
  FOREGROUND_SYNC_INTERVAL_MS,
  SESSION_VERIFY_INTERVAL_MS,
  setBootSyncTimestamp
} from '../src/composables/useSync.js';
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

describe('Foreground 10s periodic sync, visibility and serialization', () => {
  const currentUser = {
    userKey: 'user:martin',
    username: 'martin',
    sessionToken: 'test_session_token_123'
  };
  const currentSettings = { workStart: '06:30', workEnd: '15:00' };

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

    // Nyní proběhla druhá návazná synchronizace a zachovala lehké options z 10s pollingu
    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(syncSpy).toHaveBeenLastCalledWith(currentUser, currentSettings, {
      pushLocalDays: false,
      incremental: true,
      fetchProfile: false
    });

    stopForegroundSync();
  });

  it('pending follow-up preserves lightweight incremental options from 10s polling and does not turn into full sync, while upgrading if a full sync was also requested', async () => {
    let resolveFirstSync;
    const firstSyncPromise = new Promise((resolve) => {
      resolveFirstSync = resolve;
    });

    const syncSpy = vi.spyOn(syncService, 'performFullSync')
      .mockImplementationOnce(() => firstSyncPromise)
      .mockResolvedValue({ status: 'online', recordsMap: new Map() });

    const { sync, startForegroundSync, triggerPeriodicSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, currentSettings);

    // 1. První lehký sync běží
    const activePromise = triggerPeriodicSync();
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenLastCalledWith(currentUser, currentSettings, {
      pushLocalDays: false,
      incremental: true,
      fetchProfile: false
    });

    // 2. Během něj přijde další 10s periodický sync (a ještě jeden) -> nesmí běžet paralelně
    await triggerPeriodicSync();
    await triggerPeriodicSync();
    expect(syncSpy).toHaveBeenCalledTimes(1);

    // 3. Dokončíme první sync
    resolveFirstSync({ status: 'online', recordsMap: new Map() });
    await activePromise;

    // 4. Po 50ms proběhne follow-up a MUSÍ mít stále incremental:true, fetchProfile:false, pushLocalDays:false
    await vi.advanceTimersByTimeAsync(60);
    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(syncSpy).toHaveBeenLastCalledWith(currentUser, currentSettings, {
      pushLocalDays: false,
      incremental: true,
      fetchProfile: false
    });

    // 5. Ověření sloučení: pokud během lehkého syncu přijde i požadavek na plný sync, follow-up provede plný sync
    let resolveSecondSync;
    const secondSyncPromise = new Promise((resolve) => {
      resolveSecondSync = resolve;
    });
    syncSpy.mockImplementationOnce(() => secondSyncPromise);

    const secondActive = triggerPeriodicSync();
    expect(syncSpy).toHaveBeenCalledTimes(3);

    // Během lehkého syncu přijde jak lehký, tak plný požadavek
    await triggerPeriodicSync();
    await sync(currentUser, currentSettings, { pushLocalDays: true, incremental: false, fetchProfile: true });
    expect(syncSpy).toHaveBeenCalledTimes(3);

    resolveSecondSync({ status: 'online', recordsMap: new Map() });
    await secondActive;
    await vi.advanceTimersByTimeAsync(60);

    expect(syncSpy).toHaveBeenCalledTimes(4);
    expect(syncSpy).toHaveBeenLastCalledWith(currentUser, currentSettings, {
      pushLocalDays: true,
      incremental: false,
      fetchProfile: true
    });

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

  it('unified reconnect flow: verifies session on online event before running full sync', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });

    const fakeVerify = vi.fn().mockResolvedValue(true);

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, currentSettings, null, {
      onVerifySession: fakeVerify
    });

    globalThis.window.dispatchEvent({ type: 'online' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fakeVerify).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledTimes(1);

    stopForegroundSync();
  });

  it('unified reconnect flow: invalid session calls onInvalidSession and does not sync', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });

    const fakeVerify = vi.fn().mockResolvedValue(false);
    const fakeInvalid = vi.fn();

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, currentSettings, null, {
      onVerifySession: fakeVerify,
      onInvalidSession: fakeInvalid
    });

    globalThis.window.dispatchEvent({ type: 'online' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fakeVerify).toHaveBeenCalledTimes(1);
    expect(fakeInvalid).toHaveBeenCalledTimes(1);
    expect(syncSpy).not.toHaveBeenCalled();

    stopForegroundSync();
  });

  it('uses updated settings on subsequent periodic sync via getter () => settings.value without stale closure', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });

    let liveSettings = { workStart: '06:30', workEnd: '15:00', dailyTargetMinutes: 480 };
    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, () => liveSettings);

    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    expect(syncSpy).toHaveBeenLastCalledWith(currentUser, liveSettings, expect.any(Object));

    const updatedSettings = { workStart: '07:00', workEnd: '15:30', dailyTargetMinutes: 480 };
    liveSettings = updatedSettings;

    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    expect(syncSpy).toHaveBeenLastCalledWith(currentUser, updatedSettings, expect.any(Object));

    stopForegroundSync();
  });

  it('periodic session verification is NOT triggered every 10s, only every 5 minutes (SESSION_VERIFY_INTERVAL_MS)', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });
    const fakeVerify = vi.fn().mockResolvedValue(true);
    const fakeInvalid = vi.fn();

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, () => currentSettings, null, {
      onVerifySession: fakeVerify,
      onInvalidSession: fakeInvalid
    });

    // Během 60 sekund (6x 10s sync) se verifySession NESMÍ zavolat ani jednou
    await vi.advanceTimersByTimeAsync(6 * FOREGROUND_SYNC_INTERVAL_MS);
    expect(syncSpy).toHaveBeenCalledTimes(6);
    expect(fakeVerify).not.toHaveBeenCalled();

    // Po dosažení 5 minut (300 000 ms) se verifySession zavolá právě 1x
    await vi.advanceTimersByTimeAsync(SESSION_VERIFY_INTERVAL_MS - 6 * FOREGROUND_SYNC_INTERVAL_MS);
    expect(fakeVerify).toHaveBeenCalledTimes(1);
    expect(fakeInvalid).not.toHaveBeenCalled();

    // Pokud při dalším 5min ověření session selže, provede se okamžitý force logout bez confirmu
    fakeVerify.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(SESSION_VERIFY_INTERVAL_MS);
    expect(fakeVerify).toHaveBeenCalledTimes(2);
    expect(fakeInvalid).toHaveBeenCalledTimes(1);

    stopForegroundSync();
  });

  it('rapid reload (F5 within 15s cooldown) STILL executes verifySession() before deciding to skip data sync', async () => {
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });
    const fakeVerify = vi.fn().mockResolvedValue(true);
    const fakeInvalid = vi.fn();
    const fakeStartService = vi.fn();

    const { runBootSyncFlow } = useSync();

    // Simulace, že před 2 sekundami proběhl plný sync
    setBootSyncTimestamp(currentUser.userKey, Date.now() - 2000);

    const resValid = await runBootSyncFlow({
      currentUser,
      settingsGetter: () => currentSettings,
      verifySessionFn: fakeVerify,
      onInvalidSessionFn: fakeInvalid,
      startServiceFn: fakeStartService
    });

    // verifySession() MUSÍ proběhnout i při rychlém reloadu, ale datový sync se přeskočí
    expect(fakeVerify).toHaveBeenCalledTimes(1);
    expect(resValid.verified).toBe(true);
    expect(resValid.mode).toBe('skip');
    expect(syncSpy).not.toHaveBeenCalled();
    expect(fakeStartService).toHaveBeenCalledTimes(1);

    // Pokud byla session mezitím na jiném zařízení revokována, rychlý reload ji okamžitě odhalí a odhlásí bez confirmu
    fakeVerify.mockResolvedValueOnce(false);
    const confirmSpy = vi.fn();
    globalThis.confirm = confirmSpy;

    const resRevoked = await runBootSyncFlow({
      currentUser,
      settingsGetter: () => currentSettings,
      verifySessionFn: fakeVerify,
      onInvalidSessionFn: fakeInvalid,
      startServiceFn: fakeStartService
    });

    expect(fakeVerify).toHaveBeenCalledTimes(2);
    expect(resRevoked.verified).toBe(false);
    expect(resRevoked.mode).toBe('invalid_session');
    expect(fakeInvalid).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('reset local data resets incremental sync cursor and immediately performs full pull when online', async () => {
    const clearSpy = vi.spyOn(idbService, 'clearUserDays').mockResolvedValue();
    const resetCursorSpy = vi.spyOn(syncService, 'resetUserSyncCursor');
    const pulledMap = new Map([['2026-10-29', { date: '2026-10-29', type: 'work', start: '06:30', end: '15:00' }]]);
    const syncSpy = vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: pulledMap,
      serverProfile: { user_key: currentUser.userKey, display_name: 'Martin' }
    });

    // Nastavíme existující inkrementální kurzor
    syncService.setLastSuccessfulPullAt(currentUser.userKey, '2026-10-29T08:00:00.000Z');
    expect(syncService.getLastSuccessfulPullAt(currentUser.userKey)).toBe('2026-10-29T08:00:00.000Z');

    const loadRecordsFn = vi.fn().mockResolvedValue();
    const onSyncCompletedFn = vi.fn().mockResolvedValue();

    const { runResetLocalDataFlow } = useSync();
    const res = await runResetLocalDataFlow({
      currentUser,
      settingsGetter: () => currentSettings,
      loadRecordsFn,
      onSyncCompletedFn
    });

    expect(clearSpy).toHaveBeenCalledWith(currentUser.userKey);
    expect(resetCursorSpy).toHaveBeenCalledWith(currentUser.userKey);
    expect(syncSpy).toHaveBeenCalledWith(currentUser, currentSettings, {
      pushLocalDays: false,
      incremental: false,
      fetchProfile: true
    });
    expect(onSyncCompletedFn).toHaveBeenCalledWith(pulledMap, expect.any(Object));
    expect(res.status).toBe('pulled');
  });

  it('frequent visibilitychange does NOT postpone 5min session verify indefinitely', async () => {
    vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });
    const fakeVerify = vi.fn().mockResolvedValue(true);

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, () => currentSettings, null, {
      onVerifySession: fakeVerify
    });

    // Uživatel každou minutu na 5 sekund přepne záložku pryč a zpět
    for (let minute = 1; minute <= 4; minute++) {
      await vi.advanceTimersByTimeAsync(55000);
      globalThis.document.visibilityState = 'hidden';
      globalThis.document.dispatchEvent({ type: 'visibilitychange' });

      await vi.advanceTimersByTimeAsync(5000);
      globalThis.document.visibilityState = 'visible';
      globalThis.document.dispatchEvent({ type: 'visibilitychange' });
    }

    // Po 4 minutách ještě verifySession neproběhl
    expect(fakeVerify).not.toHaveBeenCalled();

    // Po uplynutí zbývající 5. minuty (celkem 5 minut od startu) MUSÍ verifySession proběhnout
    await vi.advanceTimersByTimeAsync(60000);
    expect(fakeVerify).toHaveBeenCalledTimes(1);

    stopForegroundSync();
  });

  it('returning to foreground before 5 min does not trigger verifySession, returning after >= 5 min triggers it immediately', async () => {
    vi.spyOn(syncService, 'performFullSync').mockResolvedValue({
      status: 'online',
      recordsMap: new Map()
    });
    const fakeVerify = vi.fn().mockResolvedValue(true);

    const { startForegroundSync, stopForegroundSync } = useSync();
    startForegroundSync(currentUser, () => currentSettings, null, {
      onVerifySession: fakeVerify
    });

    // 1. Aplikace jde na pozadí a vrátí se po 2 minutách (< 5 min)
    globalThis.document.visibilityState = 'hidden';
    globalThis.document.dispatchEvent({ type: 'visibilitychange' });

    await vi.advanceTimersByTimeAsync(120000); // 2 minuty
    globalThis.document.visibilityState = 'visible';
    globalThis.document.dispatchEvent({ type: 'visibilitychange' });
    await Promise.resolve();

    // Před 5 minutami se verifySession nespustí
    expect(fakeVerify).not.toHaveBeenCalled();

    // 2. Znovu přepneme na pozadí na 4 minuty (celkem 6 minut od posledního ověření >= 5 min)
    globalThis.document.visibilityState = 'hidden';
    globalThis.document.dispatchEvent({ type: 'visibilitychange' });

    await vi.advanceTimersByTimeAsync(240000); // další 4 minuty
    expect(fakeVerify).not.toHaveBeenCalled(); // na pozadí neběží

    // 3. Návrat do popředí po > 5 minutách vyvolá okamžitý verifySession()
    globalThis.document.visibilityState = 'visible';
    globalThis.document.dispatchEvent({ type: 'visibilitychange' });
    await Promise.resolve();
    await Promise.resolve();

    expect(fakeVerify).toHaveBeenCalledTimes(1);

    stopForegroundSync();
  });
});

