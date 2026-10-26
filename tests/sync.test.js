import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dayRowForSupabase,
  localDayFromSupabaseRow,
  coalesceOutboxActions,
  drainOutboxQueue,
  performFullSync
} from '../src/services/sync.js';
import * as supabaseService from '../src/services/supabase.js';
import * as idbService from '../src/services/indexedDb.js';
import { DEFAULT_SETTINGS } from '../src/utils/attendance.js';

describe('Real Integration Tests for Sync Engine', () => {
  const currentUser = {
    userKey: 'user:martin',
    username: 'martin',
    pinHash: 'test_hash_123'
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('converts local day to Supabase row format including tombstones', () => {
    const localDay = {
      date: '2026-10-23',
      type: 'work',
      start: '06:30',
      end: '15:30',
      manualBreak: false,
      breakMinutes: 30,
      note: 'Projekt A',
      deletedAt: '2026-10-23T16:00:00.000Z',
      updatedAt: '2026-10-23T16:00:00.000Z'
    };

    const row = dayRowForSupabase(localDay, currentUser.userKey, DEFAULT_SETTINGS);
    expect(row.user_key).toBe('user:martin');
    expect(row.date).toBe('2026-10-23');
    expect(row.deleted_at).toBe('2026-10-23T16:00:00.000Z');
    expect(row.updated_at).toBe('2026-10-23T16:00:00.000Z');
  });

  it('converts Supabase row with deleted_at into local day tombstone', () => {
    const row = {
      user_key: 'user:martin',
      date: '2026-10-23',
      type: 'work',
      start_time: '07:00',
      end_time: '15:30',
      break_minutes: 30,
      deleted_at: '2026-10-23T18:00:00.000Z',
      updated_at: '2026-10-23T18:00:00.000Z'
    };

    const local = localDayFromSupabaseRow(row, 30);
    expect(local.date).toBe('2026-10-23');
    expect(local.deletedAt).toBe('2026-10-23T18:00:00.000Z');
    expect(local.updatedAt).toBe('2026-10-23T18:00:00.000Z');
  });

  // Test 1: Offline outbox UPSERT vs novější server
  it('Test 1 – offline UPSERT vs newer server (server_newer rejection handled safely)', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);

    const outboxAction = {
      id: 1,
      userId: currentUser.userKey,
      entity: 'attendance_days',
      action: 'UPSERT',
      payload: {
        date: '2026-10-24',
        type: 'work',
        start_time: '07:00',
        end_time: '15:30',
        updated_at: '2026-10-24T10:00:00.000Z'
      }
    };

    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([outboxAction]);
    const removeSpy = vi.spyOn(idbService, 'removeSyncAction').mockResolvedValue();

    // RPC vrací applied: false s reason: server_newer
    const supabaseSpy = vi.spyOn(supabaseService, 'supabaseRequest').mockResolvedValue({
      applied: false,
      reason: 'server_newer',
      server_updated_at: '2026-10-24T11:00:00.000Z',
      date: '2026-10-24'
    });

    const count = await drainOutboxQueue(currentUser);

    expect(count).toBe(1);
    expect(supabaseSpy).toHaveBeenCalledWith(
      '/rest/v1/rpc/upsert_attendance_day_lww',
      expect.objectContaining({ method: 'POST' }),
      currentUser
    );
    // Z outboxu je bezpečně odstraněno, protože server již obsahuje novější stav
    expect(removeSpy).toHaveBeenCalledWith(1);
  });

  // Test 2: Offline UPSERT je novější
  it('Test 2 – offline UPSERT is newer than server (applied: true)', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);

    const outboxAction = {
      id: 2,
      userId: currentUser.userKey,
      entity: 'attendance_days',
      action: 'UPSERT',
      payload: {
        date: '2026-10-24',
        type: 'work',
        start_time: '08:00',
        end_time: '16:30',
        updated_at: '2026-10-24T12:00:00.000Z'
      }
    };

    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([outboxAction]);
    const removeSpy = vi.spyOn(idbService, 'removeSyncAction').mockResolvedValue();

    vi.spyOn(supabaseService, 'supabaseRequest').mockResolvedValue({
      applied: true,
      action: 'updated',
      server_updated_at: '2026-10-24T12:00:00.000Z',
      date: '2026-10-24'
    });

    const count = await drainOutboxQueue(currentUser);

    expect(count).toBe(1);
    expect(removeSpy).toHaveBeenCalledWith(2);
  });

  // Test 3: Offline DELETE (posílá se jako tombstone)
  it('Test 3 – offline DELETE sends tombstone via RPC and removes outbox item', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);

    const deleteAction = {
      id: 3,
      userId: currentUser.userKey,
      entity: 'attendance_days',
      action: 'DELETE',
      payload: {
        date: '2026-10-25',
        deleted_at: '2026-10-25T12:00:00.000Z',
        updated_at: '2026-10-25T12:00:00.000Z'
      }
    };

    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([deleteAction]);
    const removeSpy = vi.spyOn(idbService, 'removeSyncAction').mockResolvedValue();

    const supabaseSpy = vi.spyOn(supabaseService, 'supabaseRequest').mockResolvedValue({
      applied: true,
      action: 'tombstone_updated',
      date: '2026-10-25'
    });

    const count = await drainOutboxQueue(currentUser);
    expect(count).toBe(1);
    expect(removeSpy).toHaveBeenCalledWith(3);

    const callBody = JSON.parse(supabaseSpy.mock.calls[0][1].body);
    expect(callBody.p_day.deleted_at).toBe('2026-10-25T12:00:00.000Z');
  });

  // Test 4: Server DELETE je novější než lokální kopie
  it('Test 4 – server DELETE tombstone is newer: removes local day and prevents upload', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([]);

    // Lokální záznam má čas 11:00
    vi.spyOn(idbService, 'getUserDays').mockResolvedValue([
      {
        date: '2026-10-25',
        type: 'work',
        start: '07:00',
        end: '15:30',
        updatedAt: '2026-10-25T11:00:00.000Z'
      }
    ]);

    const deleteUserDaySpy = vi.spyOn(idbService, 'deleteUserDay').mockResolvedValue();

    // Server má tombstone s časem 12:00
    vi.spyOn(supabaseService, 'supabaseRequest').mockImplementation(async (url) => {
      if (url.includes('attendance_profiles')) return [];
      if (url.includes('attendance_days')) {
        return [
          {
            user_key: currentUser.userKey,
            date: '2026-10-25',
            type: 'work',
            deleted_at: '2026-10-25T12:00:00.000Z',
            updated_at: '2026-10-25T12:00:00.000Z'
          }
        ];
      }
      return [];
    });

    const result = await performFullSync(currentUser, DEFAULT_SETTINGS);

    expect(result.status).toBe('online');
    expect(deleteUserDaySpy).toHaveBeenCalledWith(currentUser.userKey, '2026-10-25');
    expect(result.recordsMap.has('2026-10-25')).toBe(false);
  });

  // Test 5: Starý tombstone vs nový update (nový update oživí záznam)
  it('Test 5 – newer local update resurrects older server tombstone', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);
    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([]);

    // Lokální záznam je novější (14:00)
    vi.spyOn(idbService, 'getUserDays').mockResolvedValue([
      {
        date: '2026-10-25',
        type: 'work',
        start: '08:00',
        end: '16:30',
        updatedAt: '2026-10-25T14:00:00.000Z'
      }
    ]);

    let uploadedPayload = null;
    vi.spyOn(supabaseService, 'supabaseRequest').mockImplementation(async (url, opts) => {
      if (url.includes('attendance_profiles')) return [];
      if (url.includes('attendance_days?user_key=')) {
        // Server měl starý tombstone v 10:00
        return [
          {
            user_key: currentUser.userKey,
            date: '2026-10-25',
            type: 'work',
            deleted_at: '2026-10-25T10:00:00.000Z',
            updated_at: '2026-10-25T10:00:00.000Z'
          }
        ];
      }
      if (url.includes('upsert_attendance_day_lww')) {
        uploadedPayload = JSON.parse(opts.body).p_day;
        return { applied: true };
      }
      return [];
    });

    const result = await performFullSync(currentUser, DEFAULT_SETTINGS);

    expect(result.status).toBe('online');
    expect(result.recordsMap.has('2026-10-25')).toBe(true);
    expect(uploadedPayload).toBeTruthy();
    expect(uploadedPayload.deleted_at).toBeNull();
    expect(uploadedPayload.updated_at).toBe('2026-10-25T14:00:00.000Z');
  });

  // Test 6: Výpadek sítě při drainOutbox
  it('Test 6 – network failure during drainOutbox preserves queue and updates retry counter', async () => {
    vi.spyOn(supabaseService, 'isSupabaseConfigured').mockReturnValue(true);

    const pendingItem = {
      id: 99,
      userId: currentUser.userKey,
      entity: 'attendance_days',
      action: 'UPSERT',
      payload: { date: '2026-10-26', updated_at: '2026-10-26T08:00:00.000Z' },
      retries: 0
    };

    vi.spyOn(idbService, 'getPendingSyncActions').mockResolvedValue([pendingItem]);
    const updateSpy = vi.spyOn(idbService, 'updateSyncAction').mockResolvedValue();
    const removeSpy = vi.spyOn(idbService, 'removeSyncAction').mockResolvedValue();

    // Síť selže
    vi.spyOn(supabaseService, 'supabaseRequest').mockRejectedValue(new Error('Network error (offline)'));

    const count = await drainOutboxQueue(currentUser);

    expect(count).toBe(0);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 99, retries: 1 }));
    expect(removeSpy).not.toHaveBeenCalled();
  });

  // Test 7: Dvě změny stejného dne v outboxu (coalesce zachová novější)
  it('Test 7 – coalesce multiple changes of the same day in outbox', () => {
    const rawActions = [
      {
        id: 10,
        entity: 'attendance_days',
        action: 'UPSERT',
        payload: { date: '2026-10-26', start_time: '07:00', updated_at: '2026-10-26T10:00:00.000Z' }
      },
      {
        id: 11,
        entity: 'attendance_days',
        action: 'UPSERT',
        payload: { date: '2026-10-26', start_time: '07:15', updated_at: '2026-10-26T11:00:00.000Z' }
      }
    ];

    const coalesced = coalesceOutboxActions(rawActions);
    expect(coalesced.length).toBe(1);
    expect(coalesced[0].id).toBe(11);
    expect(coalesced[0].payload.start_time).toBe('07:15');
    expect(coalesced[0].obsoleteIds).toEqual([10]);
  });

  // Test 8: UPDATE následovaný DELETE pro stejný den
  it('Test 8 – UPDATE followed by DELETE results in tombstone DELETE only', () => {
    const rawActions = [
      {
        id: 20,
        entity: 'attendance_days',
        action: 'UPSERT',
        payload: { date: '2026-10-27', start_time: '07:00', updated_at: '2026-10-27T10:00:00.000Z' }
      },
      {
        id: 21,
        entity: 'attendance_days',
        action: 'DELETE',
        payload: { date: '2026-10-27', deleted_at: '2026-10-27T12:00:00.000Z', updated_at: '2026-10-27T12:00:00.000Z' }
      }
    ];

    const coalesced = coalesceOutboxActions(rawActions);
    expect(coalesced.length).toBe(1);
    expect(coalesced[0].id).toBe(21);
    expect(coalesced[0].action).toBe('DELETE');
    expect(coalesced[0].payload.deleted_at).toBe('2026-10-27T12:00:00.000Z');
    expect(coalesced[0].obsoleteIds).toEqual([20]);
  });
});
