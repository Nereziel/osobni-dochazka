import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, monthStats, closedBalanceBeforeDate, yearVacationUsed, monthVacationDays, isIncompleteWorkday } from '../src/utils/attendance.js';

const record = (date, type, start = '', end = '', extra = {}) => [date, { date, type, start, end, ...extra }];

describe('Closed and planned monthly attendance', () => {
  it('excludes future records, incomplete shifts and tombstones from actual totals', () => {
    const map = new Map([
      record('2026-11-23', 'work', '07:00', '15:15'),
      record('2026-11-24', 'work', '22:00'),
      record('2026-11-25', 'halfVacation'),
      record('2026-11-26', 'work', '07:00', '15:30', { deletedAt: '2026-11-26T15:30:00Z' }),
      record('2026-11-27', 'work', '07:45'),
      record('2026-11-30', 'work', '06:30', '18:00')
    ]);
    const stats = monthStats('2026-11-01', map, DEFAULT_SETTINGS, '2026-11-27');
    expect(stats.completedBalance).toBe(-15);
    expect(stats.worked).toBe(465);
    expect(stats.credited).toBe(0);
    expect(stats.completedFund).toBe(480);
    expect(stats.incomplete).toBe(3);
    expect(stats.planned).toBe(1);
    expect(closedBalanceBeforeDate('2026-11-27', map, DEFAULT_SETTINGS)).toBe(-15);
  });

  it('attributes completed overnight shifts to their start date and month', () => {
    const map = new Map([record('2026-11-30', 'work', '22:00', '06:30')]);
    expect(monthStats('2026-11-01', map, DEFAULT_SETTINGS, '2026-12-01').worked).toBe(480);
    expect(monthStats('2026-12-01', map, DEFAULT_SETTINGS, '2026-12-01').worked).toBe(0);
  });

  it('recognizes explicit absence-only records but not missing work times', () => {
    expect(isIncompleteWorkday({ type: 'doctor', doctorFullDay: true })).toBe(false);
    expect(isIncompleteWorkday({ type: 'other', otherMinutes: 120 })).toBe(false);
    expect(isIncompleteWorkday({ type: 'halfVacation' })).toBe(true);
    expect(isIncompleteWorkday({ type: 'work', end: '15:30' })).toBe(true);
  });

  it('counts vacation only on scheduled days, including booked future vacation', () => {
    const map = new Map([
      record('2026-11-17', 'vacation'),
      record('2026-11-21', 'vacation'),
      record('2026-11-23', 'halfVacation'),
      record('2026-11-24', 'vacation', '', '', { deletedAt: '2026-11-24' }),
      record('2026-11-30', 'vacation')
    ]);
    expect(yearVacationUsed(2026, map, DEFAULT_SETTINGS)).toBe(1.5);
    expect(monthVacationDays('2026-11-01', map, DEFAULT_SETTINGS)).toBe(1.5);
    expect(yearVacationUsed(2026, map, { ...DEFAULT_SETTINGS, workOnHolidays: true, workDays: [1,2,3,4,5,6] })).toBe(3.5);
  });
});
