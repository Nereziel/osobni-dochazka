import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isScheduledWorkday,
  baseTargetForDate,
  targetForDay,
  calculatedBreak,
  workedMinutes,
  creditedMinutes,
  dayMetrics,
  calculateWorkEndTime,
  monthStats
} from '../src/utils/attendance.js';

describe('Attendance calculations and business logic', () => {
  const customSettings = {
    ...DEFAULT_SETTINGS,
    workStart: '06:30',
    workEnd: '15:30',
    dailyTargetMinutes: 510, // 8:30
    breakMinutes: 30,
    breakAfterMinutes: 360,  // 6:00
    workDays: [1, 2, 3, 4, 5],
    workOnHolidays: false
  };

  it('default settings: 06:30 to 15:00 results in 8h work, 30m break, 480m target, 0 balance', () => {
    expect(DEFAULT_SETTINGS.workStart).toBe('06:30');
    expect(DEFAULT_SETTINGS.workEnd).toBe('15:00');
    expect(DEFAULT_SETTINGS.dailyTargetMinutes).toBe(480);
    expect(DEFAULT_SETTINGS.breakMinutes).toBe(30);

    const normalDay = {
      date: '2026-10-23',
      type: 'work',
      start: DEFAULT_SETTINGS.workStart,
      end: DEFAULT_SETTINGS.workEnd,
      manualBreak: false
    };

    const metrics = dayMetrics(normalDay, DEFAULT_SETTINGS);
    expect(metrics.worked).toBe(480); // 8:00
    expect(metrics.breakMinutes).toBe(30);
    expect(metrics.target).toBe(480);
    expect(metrics.balance).toBe(0);
  });

  it('determines scheduled workdays correctly', () => {
    expect(isScheduledWorkday(undefined)).toBe(false);
    expect(isScheduledWorkday(null)).toBe(false);
    expect(isScheduledWorkday(() => {})).toBe(false);

    // 2026-10-23 je pátek (pracovní den)
    expect(isScheduledWorkday('2026-10-23', customSettings)).toBe(true);
    // 2026-10-24 je sobota (víkend)
    expect(isScheduledWorkday('2026-10-24', customSettings)).toBe(false);
    // 2026-10-28 je státní svátek
    expect(isScheduledWorkday('2026-10-28', customSettings)).toBe(false);

    // Pokud uživatel pracuje i ve svátky:
    const holidayWorkSettings = { ...customSettings, workOnHolidays: true };
    expect(isScheduledWorkday('2026-10-28', holidayWorkSettings)).toBe(true);
  });

  it('calculates base target for date correctly', () => {
    expect(baseTargetForDate('2026-10-23', customSettings)).toBe(510); // pátek
    expect(baseTargetForDate('2026-10-24', customSettings)).toBe(0);   // sobota
    expect(baseTargetForDate('2026-10-28', customSettings)).toBe(0);   // svátek
  });

  it('calculates break automatically when duration >= breakAfterMinutes', () => {
    // 6:30 do 15:30 = 9 hodin (540 min) >= 6 hodin (360 min) -> 30 min pauza
    const dayNormal = {
      date: '2026-10-23',
      type: 'work',
      start: '06:30',
      end: '15:30',
      manualBreak: false,
      breakMinutes: 30
    };
    expect(calculatedBreak(dayNormal, customSettings)).toBe(30);

    // Krátká směna 4 hodiny (240 min) < 360 min -> 0 min pauza
    const dayShort = {
      date: '2026-10-23',
      type: 'work',
      start: '08:00',
      end: '12:00',
      manualBreak: false,
      breakMinutes: 30
    };
    expect(calculatedBreak(dayShort, customSettings)).toBe(0);

    // Vlastní manuální pauza
    const dayManual = {
      date: '2026-10-23',
      type: 'work',
      start: '08:00',
      end: '12:00',
      manualBreak: true,
      breakMinutes: 45
    };
    expect(calculatedBreak(dayManual, customSettings)).toBe(45);
  });

  it('calculates worked minutes accurately', () => {
    // 6:30 do 15:30 = 540 min - 30 min pauza = 510 min (8:30)
    const day = {
      date: '2026-10-23',
      type: 'work',
      start: '06:30',
      end: '15:30',
      manualBreak: false
    };
    expect(workedMinutes(day, customSettings)).toBe(510);
  });

  it('calculates doctor absence inside worked presence without double counting', () => {
    // Směna 08:00 - 16:30 (presence 510 min, break 30 min = 480 min).
    // Lékař byl od 10:00 do 12:00 (120 min uvnitř směny).
    // Čistá odpracovaná doba = 480 - 120 = 360 min.
    const day = {
      date: '2026-10-23',
      type: 'doctor',
      start: '08:00',
      end: '16:30',
      manualBreak: false,
      doctorFullDay: false,
      doctorStart: '10:00',
      doctorEnd: '12:00'
    };

    expect(workedMinutes(day, customSettings)).toBe(360);
    expect(creditedMinutes(day, customSettings)).toBe(120);

    const m = dayMetrics(day, customSettings);
    expect(m.worked).toBe(360);
    expect(m.credited).toBe(120);
    expect(m.counted).toBe(480);
    expect(m.target).toBe(510);
    expect(m.balance).toBe(-30);
  });

  it('calculates vacation and full day doctor correctly on workdays', () => {
    const dayVacation = {
      date: '2026-10-23', // pracovní den (target = 510)
      type: 'vacation'
    };
    expect(creditedMinutes(dayVacation, customSettings)).toBe(510);

    const m = dayMetrics(dayVacation, customSettings);
    expect(m.balance).toBe(0);

    const dayHalfVacation = {
      date: '2026-10-23',
      type: 'halfVacation'
    };
    expect(creditedMinutes(dayHalfVacation, customSettings)).toBe(255);

    const dayDoctorFull = {
      date: '2026-10-23',
      type: 'doctor',
      doctorFullDay: true
    };
    expect(creditedMinutes(dayDoctorFull, customSettings)).toBe(510);
  });

  // ========================================================================
  // KRITICKÝ TEST: target = 0 nesmí vytvářet kladné saldo!
  // ========================================================================
  it('CRITICAL: target = 0 must NOT credit minutes or create artificial positive balance', () => {
    // Sobota 2026-10-24 -> target = 0
    const saturdayHalfVacation = {
      date: '2026-10-24',
      type: 'halfVacation'
    };
    expect(targetForDay(saturdayHalfVacation, customSettings)).toBe(0);
    expect(creditedMinutes(saturdayHalfVacation, customSettings)).toBe(0);

    const metricsSatHalf = dayMetrics(saturdayHalfVacation, customSettings);
    expect(metricsSatHalf.balance).toBe(0);
    expect(metricsSatHalf.credited).toBe(0);

    // Neděle s celodenním lékařem
    const sundayDoctor = {
      date: '2026-10-25',
      type: 'doctor',
      doctorFullDay: true
    };
    expect(creditedMinutes(sundayDoctor, customSettings)).toBe(0);
    expect(dayMetrics(sundayDoctor, customSettings).balance).toBe(0);

    // Státní svátek s jinou absencí
    const holidayOther = {
      date: '2026-10-28',
      type: 'other',
      otherMinutes: 240
    };
    expect(creditedMinutes(holidayOther, customSettings)).toBe(0);
    expect(dayMetrics(holidayOther, customSettings).balance).toBe(0);
  });

  it('calculates month statistics accurately', () => {
    const monthDate = new Date(2026, 9, 1, 12); // Říjen 2026
    const recordsMap = new Map();

    // 2026-10-01 (čtvrtek) odpracováno 540 min při fondu 510 -> +30 min saldo
    recordsMap.set('2026-10-01', {
      date: '2026-10-01',
      type: 'work',
      start: '06:00',
      end: '15:30', // 570 min - 30 pauza = 540 min
      manualBreak: false
    });

    // 2026-10-02 (pátek) celodenní dovolená -> 510 min omluveno, saldo 0
    recordsMap.set('2026-10-02', {
      date: '2026-10-02',
      type: 'vacation'
    });

    const stats = monthStats(monthDate, recordsMap, customSettings);
    expect(stats.recorded).toBe(2);
    expect(stats.worked).toBe(540);
    expect(stats.credited).toBe(510);
    expect(stats.balance).toBe(30);
    expect(stats.completedBalance).toBe(30);
  });

  it('excludes today ongoing shift from completedBalance so daily target does not create artificial -8h deficit while shift is running', () => {
    const monthDate = new Date(2026, 9, 1, 12); // Říjen 2026
    const recordsMap = new Map();

    // 2026-10-01 uzavřený den s +30 min saldem
    recordsMap.set('2026-10-01', {
      date: '2026-10-01',
      type: 'work',
      start: '06:00',
      end: '15:30',
      manualBreak: false
    });

    // 2026-10-02 právě probíhající směna (start vyplněn, end prázdný)
    recordsMap.set('2026-10-02', {
      date: '2026-10-02',
      type: 'work',
      start: '06:30',
      end: '',
      manualBreak: false
    });

    const stats = monthStats(monthDate, recordsMap, customSettings, '2026-10-02');
    // completedBalance ukazuje čistých +30 min z uzavřených dnů (neodečítá 510m dnešního neukončeného fondu)
    expect(stats.completedBalance).toBe(30);
    // surové balance obsahuje i neukončený dnešek (-510 + 30 = -480)
    expect(stats.balance).toBe(-480);
  });

  it('calculates work end time correctly based on start, target, break and credited absence', () => {
    // 06:30 příchod + 8:00 fond (480 min) + 30 min oběd = 15:00
    expect(calculateWorkEndTime('06:30', DEFAULT_SETTINGS)).toBe('15:00');

    // 06:45 příchod + 8:00 fond + 30 min oběd = 15:15
    expect(calculateWorkEndTime('06:45', DEFAULT_SETTINGS)).toBe('15:15');

    // 07:00 příchod + 8:00 fond + 30 min oběd = 15:30
    expect(calculateWorkEndTime('07:00', DEFAULT_SETTINGS)).toBe('15:30');

    // 06:30 příchod s 2h (120 min) uznanou absencí (např. lékař) -> zbývá 6h práce + 30m oběd -> 13:00
    expect(calculateWorkEndTime('06:30', DEFAULT_SETTINGS, 120)).toBe('13:00');

    // 06:30 příchod s manuální přestávkou 45 min -> 15:15
    expect(calculateWorkEndTime('06:30', DEFAULT_SETTINGS, 0, 45)).toBe('15:15');
  });

  it('calculates work end time correctly for weekend with custom target', () => {
    const weekendSettings = {
      ...DEFAULT_SETTINGS,
      weekendCustomHours: true,
      weekendTargetMinutes: 240 // 4 hodiny (méně než 6h -> pauza 0 min)
    };
    // Příchod v 08:00 při víkendovém fondu 240 min -> odchod 12:00
    expect(calculateWorkEndTime('08:00', weekendSettings, 0, null, 240)).toBe('12:00');

    // Víkendový fond 420 min (7h) -> povinná 30min pauza -> 450 min přítomnosti -> příchod v 07:00 -> odchod 14:30
    expect(calculateWorkEndTime('07:00', weekendSettings, 0, null, 420)).toBe('14:30');
  });
});

