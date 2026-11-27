import { describe, expect, it } from 'vitest';
import { roundAttendanceTime, roundAttendanceTimes } from '../src/utils/time.js';
import { applyQuickArrival, applyQuickDeparture, dayMetrics, findActiveShiftRecord, DEFAULT_SETTINGS } from '../src/utils/attendance.js';

describe('Five-minute attendance rounding', () => {
  it.each([
    ['07:10','07:10'], ['07:11','07:10'], ['07:12','07:10'],
    ['07:13','07:15'], ['07:14','07:15'], ['07:58','08:00'],
    ['00:02','00:00'], ['23:57','23:55'], ['23:58','23:55'], ['23:59','23:55'],
    ['', ''], ['25:00','25:00']
  ])('rounds %s to %s without changing the date', (input, expected) => {
    expect(roundAttendanceTime(input)).toBe(expected);
  });

  it('rounds quick arrival and departure, retaining other fields', () => {
    const day = { date: '2026-11-23', type: 'work', start: '', end: '', note: 'test' };
    applyQuickArrival(day, '07:13');
    applyQuickDeparture(day, '15:47', '06:30');
    expect(day).toMatchObject({ start: '07:15', end: '15:45', note: 'test' });
    expect(dayMetrics(day, DEFAULT_SETTINGS).worked).toBe(480);
  });

  it('does not change precise historical endpoints when only a note changes', () => {
    const before = { start: '07:13', end: '15:42', note: 'old' };
    expect(roundAttendanceTimes({ ...before, note: 'new' }, before)).toEqual({ ...before, note: 'new' });
  });

  it('rounds manually changed endpoints only', () => {
    const before = { start: '07:13', end: '15:42' };
    expect(roundAttendanceTimes({ ...before, end: '15:48' }, before)).toMatchObject({ start: '07:13', end: '15:50' });
  });

  it('does not turn a short shift with a legacy arrival into an overnight shift', () => {
    const day = { start: '07:16', end: '07:17' };
    expect(roundAttendanceTimes(day, { start: day.start })).toMatchObject({ start: '07:16', end: '07:20' });
    const late = { start: '23:58', end: '23:59' };
    expect(roundAttendanceTimes(late, { start: late.start })).toMatchObject(late);
  });

  it('retains genuine overnight shifts and rounds midnight departures', () => {
    const day = { date: '2026-11-23', type: 'work', start: '22:15', end: '' };
    applyQuickDeparture(day, '00:03', '06:30');
    expect(day).toMatchObject({ date: '2026-11-23', start: '22:15', end: '00:05' });
  });

  it('recognizes a newly rounded-up arrival immediately, not distant future plans', () => {
    const now = new Date(2026,10,23,7,13);
    const day = { date: '2026-11-23', type: 'work', start: '07:15', end: '', updatedAt: now.toISOString() };
    expect(findActiveShiftRecord(new Map([[day.date, day]]), now)).toBe(day);
    expect(findActiveShiftRecord(new Map([[day.date, { ...day, start: '08:00' }]]), now)).toBeNull();
  });
});
