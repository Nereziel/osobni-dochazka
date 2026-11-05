import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/utils/attendance.js';

vi.mock('../src/services/indexedDb.js', () => ({
  getUserDays: vi.fn(async () => []),
  putUserDay: vi.fn(async () => {}),
  deleteUserDay: vi.fn(async () => {}),
  enqueueSyncAction: vi.fn(async () => 7),
  putUserDayWithOutbox: vi.fn(async () => 18),
  deleteUserDayWithOutbox: vi.fn(async () => 19),
  getPendingSyncActions: vi.fn(async () => []),
  removeSyncAction: vi.fn(async () => {}),
  updateSyncAction: vi.fn(async () => {})
}));

vi.mock('../src/services/supabase.js', () => ({
  supabaseRequest: vi.fn(async () => ({ applied: true, server_updated_at: new Date().toISOString() }))
}));

import * as db from '../src/services/indexedDb.js';
import { supabaseRequest } from '../src/services/supabase.js';
import { useAttendance } from '../src/composables/useAttendance.js';
import { drainOutboxQueue } from '../src/services/sync.js';

const user = { userKey: 'user:a', username: 'a' };
const baseDay = { date: '2026-11-05', type: 'work', start: '07:00', end: '15:30' };

describe('Crash-safe attendance persistence and visible conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.putUserDayWithOutbox.mockResolvedValue(18);
    db.deleteUserDayWithOutbox.mockResolvedValue(19);
    supabaseRequest.mockResolvedValue({ applied: true, server_updated_at: new Date().toISOString() });
  });

  it('journals the day atomically before a cloud request and clears only its accepted queue item', async () => {
    const model = useAttendance();
    await model.loadRecords(null);
    const saved = await model.saveDay(baseDay, user, DEFAULT_SETTINGS);
    expect(db.putUserDayWithOutbox).toHaveBeenCalledWith(user.userKey, expect.objectContaining({ date: baseDay.date }), expect.objectContaining({ date: baseDay.date }));
    expect(db.removeSyncAction).toHaveBeenCalledWith(18);
    expect(saved.syncStatus).toBe('synced');
  });

  it('keeps the locally saved change and its outbox item when server_newer rejects it', async () => {
    supabaseRequest.mockResolvedValue({
      applied: false, reason: 'server_newer', server_updated_at: '2026-11-05T17:00:00Z'
    });
    const model = useAttendance();
    await model.loadRecords(null);
    const saved = await model.saveDay(baseDay, user, DEFAULT_SETTINGS);
    expect(saved.syncStatus).toBe('conflict');
    expect(model.records.value.get(baseDay.date).start).toBe('07:00');
    expect(db.removeSyncAction).not.toHaveBeenCalled();
  });

  it('keeps an outbox action when the network fails after a successful local commit', async () => {
    supabaseRequest.mockRejectedValue(new Error('Network unavailable'));
    const model = useAttendance();
    await model.loadRecords(null);
    const saved = await model.saveDay(baseDay, user, DEFAULT_SETTINGS);
    expect(db.putUserDayWithOutbox).toHaveBeenCalled();
    expect(saved.syncStatus).toBe('queued');
    expect(db.removeSyncAction).not.toHaveBeenCalled();
  });

  it('journals deletions before RPC and reports cloud conflicts', async () => {
    supabaseRequest.mockResolvedValue({ applied: false, reason: 'server_newer' });
    const model = useAttendance();
    const result = await model.deleteDay(baseDay.date, user);
    expect(db.deleteUserDayWithOutbox).toHaveBeenCalledWith(user.userKey, baseDay.date, expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(result.syncStatus).toBe('conflict');
    expect(db.removeSyncAction).not.toHaveBeenCalled();
  });

  it('does not discard offline writes rejected by server_newer on retry', async () => {
    const action = {
      id: 50, userId: user.userKey, entity: 'attendance_days', action: 'UPSERT',
      payload: { date: baseDay.date, type: 'work', updated_at: '2026-11-05T07:00:00Z' }
    };
    db.getPendingSyncActions.mockResolvedValue([action]);
    supabaseRequest.mockResolvedValue({ applied: false, reason: 'server_newer' });
    const count = await drainOutboxQueue(user);
    expect(count).toBe(0);
    expect(db.removeSyncAction).not.toHaveBeenCalled();
    expect(db.updateSyncAction).toHaveBeenCalledWith(expect.objectContaining({ id: 50, conflict: true }));
  });
});
