import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  calculateWorkEndTimeForRecord,
  findActiveShiftRecord
} from '../src/utils/attendance.js';
import { calculateNetScheduleMinutes, shiftElapsedSeconds } from '../src/utils/time.js';

describe('Attendance time and midnight regression coverage', () => {
  it('does not double count doctor credit when appointment is inside work presence', () => {
    expect(calculateWorkEndTimeForRecord({
      date: '2026-11-05', type: 'doctor', start: '06:30', end: '',
      doctorFullDay: false, doctorStart: '10:00', doctorEnd: '12:00',
      manualBreak: false
    }, DEFAULT_SETTINGS)).toBe('15:00');
  });

  it('uses credit for doctor appointment completed before work begins', () => {
    expect(calculateWorkEndTimeForRecord({
      date: '2026-11-05', type: 'doctor', start: '10:15', end: '',
      doctorFullDay: false, doctorStart: '08:00', doctorEnd: '10:00',
      manualBreak: false
    }, DEFAULT_SETTINGS)).toBe('16:45');
  });

  it('uses the configured manual break in doctor end-time forecasts', () => {
    expect(calculateWorkEndTimeForRecord({
      date: '2026-11-05', type: 'doctor', start: '06:30', end: '',
      doctorFullDay: false, doctorStart: '10:00', doctorEnd: '12:00',
      manualBreak: true, breakMinutes: 45
    }, DEFAULT_SETTINGS)).toBe('15:15');
  });

  it('does not deduct a standard break on a four-hour shift', () => {
    expect(calculateNetScheduleMinutes('08:00', '12:00', 30, 360)).toBe(240);
    expect(calculateNetScheduleMinutes('06:30', '15:00', 30, 360)).toBe(480);
  });

  it('does not turn a future arrival into 20+ hours of elapsed time', () => {
    const now = new Date(2026, 10, 5, 9, 0, 0);
    expect(shiftElapsedSeconds('2026-11-05', '18:00', now)).toBe(0);
  });

  it('correctly counts a shift started yesterday after midnight', () => {
    const now = new Date(2026, 10, 6, 1, 0, 0);
    expect(shiftElapsedSeconds('2026-11-05', '22:30', now)).toBe(9000);
    const records = new Map([
      ['2026-11-05', { date: '2026-11-05', type: 'work', start: '22:30', end: '' }]
    ]);
    expect(findActiveShiftRecord(records, now)?.date).toBe('2026-11-05');
  });

  it('does not mistake stale past shifts or future starts for a current shift', () => {
    const now = new Date(2026, 10, 6, 9, 0, 0);
    const records = new Map([
      ['2026-11-05', { date: '2026-11-05', type: 'work', start: '06:00', end: '' }],
      ['2026-11-06', { date: '2026-11-06', type: 'work', start: '18:00', end: '' }]
    ]);
    expect(findActiveShiftRecord(records, now)).toBeNull();
  });
});
