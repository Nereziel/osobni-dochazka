import { describe, it, expect } from 'vitest';
import {
  localDateKey,
  parseDateKey,
  isWeekendDate,
  addMonths,
  getDaysInMonth
} from '../src/utils/dates.js';
import { isValidDateKey } from '../src/utils/validation.js';

describe('Date utilities', () => {
  it('formats Date to YYYY-MM-DD correctly without UTC drift', () => {
    const d = new Date(2026, 9, 23, 12);
    expect(localDateKey(d)).toBe('2026-10-23');
  });

  it('parses YYYY-MM-DD to midday local date avoiding timezone shift bugs', () => {
    const parsed = parseDateKey('2026-10-23');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(9); // 0-indexed: 9 = říjen
    expect(parsed.getDate()).toBe(23);
    expect(parsed.getHours()).toBe(12);
  });

  it('detects weekends correctly', () => {
    // 2026-10-23 je pátek (5)
    expect(isWeekendDate('2026-10-23')).toBe(false);
    // 2026-10-24 je sobota (6)
    expect(isWeekendDate('2026-10-24')).toBe(true);
    // 2026-10-25 je neděle (0)
    expect(isWeekendDate('2026-10-25')).toBe(true);
  });

  it('isWeekendDate handles null, undefined and invalid inputs safely without getDay error', () => {
    expect(isWeekendDate(null)).toBe(false);
    expect(isWeekendDate(undefined)).toBe(false);
    expect(isWeekendDate('')).toBe(false);
    expect(isWeekendDate(123)).toBe(false);
    expect(isWeekendDate(() => {})).toBe(false);
  });

  it('adds and subtracts months correctly', () => {
    const base = new Date(2026, 9, 1, 12); // říjen 2026
    const next = addMonths(base, 1);
    expect(next.getMonth()).toBe(10); // listopad
    expect(next.getFullYear()).toBe(2026);

    const prev = addMonths(base, -1);
    expect(prev.getMonth()).toBe(8); // září

    const nextYear = addMonths(base, 3);
    expect(nextYear.getFullYear()).toBe(2027);
    expect(nextYear.getMonth()).toBe(0); // leden
  });

  it('calculates days in month correctly including leap years', () => {
    expect(getDaysInMonth(2026, 1)).toBe(28); // Únor 2026
    expect(getDaysInMonth(2024, 1)).toBe(29); // Přestupný únor 2024
    expect(getDaysInMonth(2026, 9)).toBe(31); // Říjen 2026
    expect(getDaysInMonth(2026, 10)).toBe(30); // Listopad 2026
  });

  it('validates date key strictly', () => {
    expect(isValidDateKey('2026-10-23')).toBe(true);
    expect(isValidDateKey('2024-02-29')).toBe(true);
    expect(isValidDateKey('2025-02-29')).toBe(false); // 2025 není přestupný
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('invalid')).toBe(false);
  });
});

