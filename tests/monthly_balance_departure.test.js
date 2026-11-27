import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, balanceDepartureHint, calculateBalanceDeparture,
  closedBalanceBeforeDate, dayMetrics
} from '../src/utils/attendance.js';

const half = { date: '2026-11-27', type: 'halfVacation', start: '07:45', end: '', manualBreak: false };

describe('Monthly balance departure recommendations', () => {
  it.each([[-15, '12:00'], [-60, '12:45'], [15, '11:30'], [30, '11:15']])(
    'projects half vacation with prior balance %i to %s', (prior, end) => {
      expect(calculateBalanceDeparture(half, DEFAULT_SETTINGS, prior)?.end).toBe(end);
      expect(dayMetrics({ ...half, end }, DEFAULT_SETTINGS).balance + prior).toBe(0);
    }
  );
  it('retains the standard time at zero balance without an extra hint', () => {
    expect(calculateBalanceDeparture(half, DEFAULT_SETTINGS, 0)).toBeNull();
    expect(balanceDepartureHint(half, DEFAULT_SETTINGS, 0)).toBe('');
  });
  it('shows the deficit and adjusted departure', () => {
    expect(balanceDepartureHint(half, DEFAULT_SETTINGS, -15)).toContain('−0:15');
    expect(balanceDepartureHint(half, DEFAULT_SETTINGS, -15)).toContain('12:00');
  });
  it('includes an automatic break when the additional work crosses its threshold', () => {
    expect(calculateBalanceDeparture(half, DEFAULT_SETTINGS, -120)?.end).toBe('14:15');
  });
  it('honors manual breaks and doctor overlaps', () => {
    expect(calculateBalanceDeparture({ ...half, manualBreak: true, breakMinutes: 20 }, DEFAULT_SETTINGS, -15)?.end).toBe('12:20');
    const doctor = { ...half, type: 'doctor', start: '06:30', doctorStart: '10:00', doctorEnd: '12:00' };
    expect(calculateBalanceDeparture(doctor, DEFAULT_SETTINGS, -15)?.end).toBe('15:15');
  });
  it('does not give a wrapped time for an impossible deficit', () => {
    expect(calculateBalanceDeparture(half, DEFAULT_SETTINGS, -2000)?.end).toBeNull();
    expect(balanceDepartureHint(half, DEFAULT_SETTINGS, -2000)).toContain('Nelze vyrovnat');
  });
  it('does not promise zero balance if credit alone exceeds the reduced target', () => {
    const result = calculateBalanceDeparture(half, DEFAULT_SETTINGS, 300);
    expect(result?.end).toBe('07:45');
    expect(result?.projectedBalance).toBe(60);
    expect(balanceDepartureHint(half, DEFAULT_SETTINGS, 300)).toContain('zbývá +1:00');
  });
  it('does not advise departure on full-day absences', () => {
    expect(calculateBalanceDeparture({ ...half, type: 'vacation' }, DEFAULT_SETTINGS, -15)).toBeNull();
    expect(calculateBalanceDeparture({ ...half, type: 'doctor', doctorFullDay: true }, DEFAULT_SETTINGS, -15)).toBeNull();
  });
  it('uses only earlier closed recorded days from the shift month', () => {
    const records = new Map([
      ['2026-10-30', { ...half, date: '2026-10-30', type: 'work', end: '16:00' }],
      ['2026-11-25', { ...half, date: '2026-11-25', end: '11:30' }],
      ['2026-11-26', { ...half, date: '2026-11-26', start: '22:30' }],
      ['2026-11-27', half],
      ['2026-11-30', { ...half, date: '2026-11-30', end: '13:00' }]
    ]);
    expect(closedBalanceBeforeDate('2026-11-27', records, DEFAULT_SETTINGS)).toBe(-15);
    expect(closedBalanceBeforeDate('2026-12-01', records, DEFAULT_SETTINGS)).toBe(0);
  });
});
