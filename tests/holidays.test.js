import { describe, it, expect } from 'vitest';
import { easterSunday, czechHolidayMap, isPublicHoliday, holidayName } from '../src/utils/holidays.js';

describe('Czech Holidays and Easter calculation', () => {
  it('calculates Easter Sunday correctly across multiple years', () => {
    // 2024: 31. březen
    const e2024 = easterSunday(2024);
    expect(e2024.getMonth()).toBe(2); // 2 = březen
    expect(e2024.getDate()).toBe(31);

    // 2025: 20. duben
    const e2025 = easterSunday(2025);
    expect(e2025.getMonth()).toBe(3); // 3 = duben
    expect(e2025.getDate()).toBe(20);

    // 2026: 5. duben
    const e2026 = easterSunday(2026);
    expect(e2026.getMonth()).toBe(3);
    expect(e2026.getDate()).toBe(5);

    // 2027: 28. březen
    const e2027 = easterSunday(2027);
    expect(e2027.getMonth()).toBe(2);
    expect(e2027.getDate()).toBe(28);
  });

  it('includes fixed Czech state holidays', () => {
    expect(isPublicHoliday('2026-01-01')).toBe(true);
    expect(holidayName('2026-01-01')).toContain('Nový rok');

    expect(isPublicHoliday('2026-05-01')).toBe(true);
    expect(holidayName('2026-05-01')).toBe('Svátek práce');

    expect(isPublicHoliday('2026-05-08')).toBe(true);
    expect(holidayName('2026-05-08')).toBe('Den vítězství');

    expect(isPublicHoliday('2026-07-05')).toBe(true);
    expect(isPublicHoliday('2026-07-06')).toBe(true);
    expect(isPublicHoliday('2026-09-28')).toBe(true);
    expect(isPublicHoliday('2026-10-28')).toBe(true);
    expect(isPublicHoliday('2026-11-17')).toBe(true);
    expect(isPublicHoliday('2026-12-24')).toBe(true);
    expect(isPublicHoliday('2026-12-25')).toBe(true);
    expect(isPublicHoliday('2026-12-26')).toBe(true);
  });

  it('includes Good Friday and Easter Monday for 2026', () => {
    // V roce 2026 je Velikonoční neděle 5. dubna
    // Velký pátek = 3. dubna 2026
    // Velikonoční pondělí = 6. dubna 2026
    expect(isPublicHoliday('2026-04-03')).toBe(true);
    expect(holidayName('2026-04-03')).toBe('Velký pátek');

    expect(isPublicHoliday('2026-04-06')).toBe(true);
    expect(holidayName('2026-04-06')).toBe('Velikonoční pondělí');

    // Běžný den není svátek
    expect(isPublicHoliday('2026-04-07')).toBe(false);
  });
});

