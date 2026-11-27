import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/services/indexedDb.js', async importOriginal => ({
  ...await importOriginal(),
  getPendingSyncActions: vi.fn(),
  getUserDay: vi.fn(),
  acceptConflictServerVersion: vi.fn()
}));
vi.mock('../src/services/supabase.js', () => ({ supabaseRequest: vi.fn() }));

import * as db from '../src/services/indexedDb.js';
import { supabaseRequest } from '../src/services/supabase.js';
import { conflictDates, reviewConflict, adoptReviewedCloudVersion } from '../src/services/conflictReview.js';

const user = 'user:a';
const date = '2026-11-26';
const item = { id: 1, userId: user, entity: 'attendance_days', action: 'UPSERT', conflict: true, payload: { date, updated_at: '2026-11-26T08:00:00Z' } };
const server = { user_key: user, date, updated_at: '2026-11-26T09:00:00Z', start_time: '07:00', end_time: '15:30' };
const local = { date, start: '08:00', end: '16:30' };

function cloud(row = server) {
  supabaseRequest.mockResolvedValueOnce({ success: true, user_key: user }).mockResolvedValueOnce([row]);
}

beforeEach(() => {
  vi.resetAllMocks();
  db.getPendingSyncActions.mockResolvedValue([item]);
  db.getUserDay.mockResolvedValue(local);
  db.acceptConflictServerVersion.mockResolvedValue(true);
});

describe('Safe conflict review', () => {
  it('lists unique conflict dates for this account only', () => {
    expect(conflictDates([item, { ...item, id: 2 }, { ...item, userId: 'user:b' }], user)).toEqual([date]);
  });
  it('does not allow another account or an unconfirmed cloud response', async () => {
    supabaseRequest.mockResolvedValueOnce({ success: true, user_key: 'user:b' });
    await expect(reviewConflict(user, date)).rejects.toThrow();
    expect(db.acceptConflictServerVersion).not.toHaveBeenCalled();
  });
  it('requires a server record rather than treating missing data as deletion', async () => {
    supabaseRequest.mockResolvedValueOnce({ success: true, user_key: user }).mockResolvedValueOnce([]);
    await expect(reviewConflict(user, date)).rejects.toThrow();
  });
  it('rejects a changed server record and preserves local changes', async () => {
    cloud();
    const preview = await reviewConflict(user, date);
    cloud({ ...server, updated_at: '2026-11-26T10:00:00Z' });
    await expect(adoptReviewedCloudVersion(preview, user)).rejects.toThrow();
    expect(db.acceptConflictServerVersion).not.toHaveBeenCalled();
  });
  it('rejects a changed queue and preserves all newer actions', async () => {
    cloud();
    const preview = await reviewConflict(user, date);
    db.getPendingSyncActions.mockResolvedValue([item, { ...item, id: 2 }]);
    cloud();
    await expect(adoptReviewedCloudVersion(preview, user)).rejects.toThrow();
    expect(db.acceptConflictServerVersion).not.toHaveBeenCalled();
  });
  it('checks the reviewed snapshots again in the transaction', async () => {
    cloud();
    const preview = await reviewConflict(user, date);
    cloud();
    db.acceptConflictServerVersion.mockResolvedValue(false);
    await expect(adoptReviewedCloudVersion(preview, user)).rejects.toThrow();
    expect(db.acceptConflictServerVersion).toHaveBeenCalledWith(user, date, preview.queue, preview.localSnapshot, preview.server);
  });
  it('accepts only the unchanged reviewed day', async () => {
    cloud();
    const preview = await reviewConflict(user, date);
    cloud();
    await adoptReviewedCloudVersion(preview, user);
    expect(db.acceptConflictServerVersion).toHaveBeenCalledWith(user, date, preview.queue, preview.localSnapshot, preview.server);
  });
});
