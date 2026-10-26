import { describe, it, expect } from 'vitest';
import {
  timeToMinutes,
  minutesToTime,
  durationMinutes,
  overlapMinutes,
  formatDuration
} from '../src/utils/time.js';
import { isValidTimeString } from '../src/utils/validation.js';

describe('Time utilities', () => {
  it('parses valid time to minutes correctly', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('06:30')).toBe(390);
    expect(timeToMinutes('15:30')).toBe(930);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('handles invalid time strings gracefully', () => {
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes('24:00')).toBeNull();
    expect(timeToMinutes('12:60')).toBeNull();
    expect(timeToMinutes('abc')).toBeNull();
  });

  it('converts minutes to HH:MM format', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(390)).toBe('06:30');
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(1439)).toBe('23:59');
  });

  it('calculates duration in minutes, including overnight shifts', () => {
    expect(durationMinutes('06:30', '15:30')).toBe(540);
    expect(durationMinutes('08:00', '16:30')).toBe(510);
    // Přechod přes půlnoc: 22:00 do 06:00 = 8 hodin = 480 min
    expect(durationMinutes('22:00', '06:00')).toBe(480);
    // Stejný čas
    expect(durationMinutes('08:00', '08:00')).toBe(0);
  });

  it('calculates interval overlaps correctly', () => {
    // Částečné překrytí: práce 08:00-16:00, lékař 10:00-12:00 -> overlap = 120 min
    expect(overlapMinutes('08:00', '16:00', '10:00', '12:00')).toBe(120);
    // Žádné překrytí: práce 08:00-12:00, lékař 13:00-14:00 -> overlap = 0
    expect(overlapMinutes('08:00', '12:00', '13:00', '14:00')).toBe(0);
  });

  it('formats duration with sign', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75, true)).toBe('+1:15');
    expect(formatDuration(-45, true)).toBe('−0:45');
    expect(formatDuration(-90)).toBe('−1:30');
  });

  it('validates time strings strictly', () => {
    expect(isValidTimeString('00:00')).toBe(true);
    expect(isValidTimeString('23:59')).toBe(true);
    expect(isValidTimeString('24:00')).toBe(false);
    expect(isValidTimeString('12:60')).toBe(false);
    expect(isValidTimeString('7:00')).toBe(false);
    expect(isValidTimeString('invalid')).toBe(false);
  });
});

