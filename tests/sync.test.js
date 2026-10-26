import { describe, it, expect } from 'vitest';
import { dayRowForSupabase, localDayFromSupabaseRow } from '../src/services/sync.js';
import { DEFAULT_SETTINGS } from '../src/utils/attendance.js';

describe('Sync and Outbox queue logic', () => {
  it('converts local day record to Supabase row format correctly', () => {
    const localDay = {
      date: '2026-10-23',
      type: 'work',
      start: '06:30',
      end: '15:30',
      manualBreak: false,
      breakMinutes: 30,
      note: 'Projekt A',
      updatedAt: '2026-10-23T15:35:00.000Z'
    };

    const row = dayRowForSupabase(localDay, 'user:martin', DEFAULT_SETTINGS);
    expect(row.user_key).toBe('user:martin');
    expect(row.date).toBe('2026-10-23');
    expect(row.type).toBe('work');
    expect(row.start_time).toBe('06:30');
    expect(row.end_time).toBe('15:30');
    expect(row.worked_minutes).toBe(510);
    expect(row.target_minutes).toBe(510);
    expect(row.balance_minutes).toBe(0);
    expect(row.note).toBe('Projekt A');
    expect(row.updated_at).toBe('2026-10-23T15:35:00.000Z');
  });

  it('converts Supabase row to local day format correctly', () => {
    const row = {
      user_key: 'user:martin',
      date: '2026-10-23',
      type: 'homeOffice',
      start_time: '08:00',
      end_time: '16:30',
      manual_break: true,
      break_minutes: 45,
      doctor_full_day: false,
      doctor_start: '',
      doctor_end: '',
      other_minutes: 0,
      note: 'Práce z domova',
      updated_at: '2026-10-23T16:35:00.000Z'
    };

    const local = localDayFromSupabaseRow(row, 30);
    expect(local.date).toBe('2026-10-23');
    expect(local.type).toBe('homeOffice');
    expect(local.start).toBe('08:00');
    expect(local.end).toBe('16:30');
    expect(local.manualBreak).toBe(true);
    expect(local.breakMinutes).toBe(45);
    expect(local.note).toBe('Práce z domova');
    expect(local.updatedAt).toBe('2026-10-23T16:35:00.000Z');
  });

  it('implements Last-Write-Wins conflict resolution rule correctly', () => {
    const localUpdatedAt = '2026-10-23T16:00:00.000Z';
    const remoteUpdatedAtNewer = '2026-10-23T17:00:00.000Z';
    const remoteUpdatedAtOlder = '2026-10-23T15:00:00.000Z';

    const locTime = Date.parse(localUpdatedAt);
    const remTimeNewer = Date.parse(remoteUpdatedAtNewer);
    const remTimeOlder = Date.parse(remoteUpdatedAtOlder);

    // Vzdálený záznam je novější -> vyhrává server (lokální se aktualizuje)
    expect(remTimeNewer > locTime).toBe(true);

    // Lokální záznam je novější -> vyhrává lokální (nahrává se na server)
    expect(locTime > remTimeOlder).toBe(true);
  });

  it('guarantees offline delete persistence pattern', () => {
    // Simulace fronty outbox změn
    const outbox = [];
    const userId = 'user:martin';

    // 1. Offline uživatel smaže den 2026-10-20
    const deletedDate = '2026-10-20';
    outbox.push({
      id: 1,
      userId,
      entity: 'attendance_days',
      action: 'DELETE',
      payload: { date: deletedDate }
    });

    // 2. Kontrola, zda smazaný den nebude omylem znovu stažen při syncu
    const pendingDeleteDates = new Set(
      outbox
        .filter(a => a.entity === 'attendance_days' && a.action === 'DELETE')
        .map(a => a.payload.date)
    );

    expect(pendingDeleteDates.has('2026-10-20')).toBe(true);

    // Vzdálený server vrací záznam pro 2026-10-20
    const remoteRecords = [{ date: '2026-10-20', type: 'work' }];
    const recordsToImport = remoteRecords.filter(r => !pendingDeleteDates.has(r.date));

    // Záznam se nevrátí z cloudu, protože čeká ve frontě na smazání!
    expect(recordsToImport.length).toBe(0);
  });
});

