import { describe, expect, it } from 'vitest';
import { pendingLocalData } from '../src/services/indexedDb.js';

const pending = [
  { entity: 'attendance_days', action: 'UPSERT', payload: { date: '2026-11-27' }, conflict: true },
  { entity: 'attendance_days', action: 'DELETE', payload: { date: '2026-11-26' } },
  { entity: 'attendance_profiles', action: 'UPDATE', payload: {} }
];

describe('Pending-only account cleanup', () => {
  it('retains dates and settings needed for unsynced changes', () => {
    expect(pendingLocalData(pending, true)).toEqual({ dates: new Set(['2026-11-27', '2026-11-26']), settings: true });
  });
  it('retains nothing on explicit destructive logout or empty queue', () => {
    expect(pendingLocalData(pending, false)).toEqual({ dates: new Set(), settings: false });
    expect(pendingLocalData([], true)).toEqual({ dates: new Set(), settings: false });
  });
});
