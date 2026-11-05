import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { validateBackupPayload, buildBackupSyncActions } from '../src/utils/backup.js';
import { DEFAULT_SETTINGS } from '../src/utils/attendance.js';
import { coalesceOutboxActions } from '../src/services/sync.js';

const valid = {
  app: 'osobni-dochazka-win11',
  days: [
    { date: '2026-11-02', type: 'doctor', start: '08:00', end: '16:30',
      doctorFullDay: false, doctorStart: '10:00', doctorEnd: '12:00', note: 'Propustka' }
  ],
  settings: { ...DEFAULT_SETTINGS, workStart: '07:00' }
};

describe('Non-destructive, validated backup restore', () => {
  it('rejects invalid date/time and duplicate entries before any mutation', () => {
    expect(() => validateBackupPayload({ ...valid, days: [{ date: '2026-02-30', type: 'work' }] })).toThrow();
    expect(() => validateBackupPayload({ ...valid, days: [{ date: '2026-11-02', type: 'work', start: '25:61' }] })).toThrow();
    expect(() => validateBackupPayload({ ...valid, days: [valid.days[0], valid.days[0]] })).toThrow();
    expect(() => validateBackupPayload({ days: 'malformed' })).toThrow();
  });

  it('preserves doctor appointment and only emits allowlisted fields', () => {
    const backup = { ...valid, days: [{ ...valid.days[0], userId: 'user:other', role: 'admin', synced: true }] };
    const parsed = validateBackupPayload(backup);
    expect(parsed.days[0]).toMatchObject({
      date: '2026-11-02', type: 'doctor', start: '08:00', end: '16:30',
      doctorStart: '10:00', doctorEnd: '12:00', note: 'Propustka'
    });
    expect(parsed.days[0]).not.toHaveProperty('userId');
    expect(parsed.days[0]).not.toHaveProperty('role');
    expect(parsed.days[0]).not.toHaveProperty('synced');
    expect(parsed.settings.workStart).toBe('07:00');
  });

  it('rejects malformed or oversized settings and day values', () => {
    expect(() => validateBackupPayload({ ...valid, settings: { breakMinutes: -5 } })).toThrow();
    expect(() => validateBackupPayload({ ...valid, days: [{ date: '2026-11-02', type: 'invalid' }] })).toThrow();
    expect(() => validateBackupPayload({ ...valid, days: [{ date: '2026-11-02', type: 'work', note: 'x'.repeat(2001) }] })).toThrow();
  });

  it('creates durable cloud actions for imported days, with settings first', () => {
    const parsed = validateBackupPayload(valid);
    const items = buildBackupSyncActions(parsed.days, parsed.settings, { userKey: 'user:a', username: 'a' });
    expect(items[0]).toMatchObject({ entity: 'attendance_profiles', action: 'UPDATE' });
    expect(items[1]).toMatchObject({
      entity: 'attendance_days', action: 'UPSERT',
      payload: { user_key: 'user:a', date: '2026-11-02', type: 'doctor' }
    });
  });

  it('syncs imported profile settings before day metrics are computed by the server', () => {
    const parsed = validateBackupPayload(valid);
    const actions = buildBackupSyncActions(parsed.days, parsed.settings, { userKey: 'user:a', username: 'a' });
    const coalesced = coalesceOutboxActions(actions.map((action, index) => ({
      ...action, id: index + 1,
      payload: { ...action.payload, updated_at: '2026-11-05T10:00:00Z' }
    })));
    expect(coalesced.map(action => action.entity)).toEqual(['attendance_profiles', 'attendance_days']);
  });

  it('uses one IndexedDB transaction and never clears all existing days before import', () => {
    const db = fs.readFileSync('src/services/indexedDb.js', 'utf8');
    const app = fs.readFileSync('src/App.vue', 'utf8');
    expect(db).toContain("transaction(['user_days', 'user_settings', 'sync_queue'], 'readwrite')");
    expect(app).toContain('validateBackupPayload(payload)');
    expect(app).toContain('importUserBackupAtomic(');
    const handler = app.split('async function handleImportBackup(file) {')[1].split('async function handleResetLocalData')[0];
    expect(handler).not.toContain('clearUserDays(userKey)');
  });
});
