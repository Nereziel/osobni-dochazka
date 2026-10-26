/**
 * Výpočty docházky, pracovního fondu, absencí a salda
 */
import { localDateKey, parseDateKey, isWeekendDate } from './dates.js';
import { isPublicHoliday } from './holidays.js';
import { durationMinutes, overlapMinutes, timeToMinutes } from './time.js';
import { clampNumber, cloneDeep } from './validation.js';

export const DEFAULT_SETTINGS = {
  id: 'settings',
  workStart: '06:30',
  workEnd: '15:30',
  dailyTargetMinutes: 510, // 8:30
  breakMinutes: 30,
  breakAfterMinutes: 360,  // 6:00
  autoFill: true,
  workDays: [1, 2, 3, 4, 5],
  workWeekends: false,
  weekendMode: 'none', // 'none' | 'saturday' | 'sunday' | 'both' | 'custom'
  weekendCustomHours: false,
  weekendStart: '07:00',
  weekendEnd: '15:30',
  weekendTargetMinutes: 480, // 8:00
  workOnHolidays: false,
  theme: 'system'
};

export const TYPE_LABELS = {
  work: 'Práce (směna)',
  homeOffice: 'Home office',
  businessTrip: 'Služební cesta',
  vacation: 'Dovolená',
  halfVacation: '½ dovolené',
  doctor: 'Lékař / Propustka',
  sick: 'Nemoc',
  holiday: 'Svátek / Volno',
  compTime: 'Náhradní volno',
  other: 'Jiné volno'
};

export const SHORT_TYPE_LABELS = {
  work: 'Směna',
  homeOffice: 'HO',
  businessTrip: 'Cesta',
  vacation: 'Dovol.',
  halfVacation: '½ dov.',
  doctor: 'Lékař',
  sick: 'Nemoc',
  holiday: 'Svátek',
  compTime: 'Náhr.',
  other: 'Jiné'
};

export function activeWorkDays(settings = DEFAULT_SETTINGS) {
  if (Array.isArray(settings?.workDays) && settings.workDays.length > 0) {
    return settings.workDays.map(Number);
  }
  return [1, 2, 3, 4, 5];
}

export function isScheduledWorkday(dateOrKey, settings = DEFAULT_SETTINGS) {
  const date = typeof dateOrKey === 'string' ? parseDateKey(dateOrKey) : dateOrKey;
  const key = typeof dateOrKey === 'string' ? dateOrKey : localDateKey(date);

  if (isPublicHoliday(key) && !settings?.workOnHolidays) {
    return false;
  }

  return activeWorkDays(settings).includes(date.getDay());
}

export function defaultHoursForDate(dateOrKey, settings = DEFAULT_SETTINGS) {
  const date = typeof dateOrKey === 'string' ? parseDateKey(dateOrKey) : dateOrKey;

  if (isWeekendDate(date) && settings?.weekendCustomHours) {
    return {
      start: settings.weekendStart || settings.workStart || '07:00',
      end: settings.weekendEnd || settings.workEnd || '15:30',
      target: Number.isFinite(settings.weekendTargetMinutes) ? settings.weekendTargetMinutes : (settings?.dailyTargetMinutes ?? 510)
    };
  }

  return {
    start: settings?.workStart || '06:30',
    end: settings?.workEnd || '15:30',
    target: settings?.dailyTargetMinutes ?? 510
  };
}

export function baseTargetForDate(dateOrKey, settings = DEFAULT_SETTINGS) {
  if (!isScheduledWorkday(dateOrKey, settings)) {
    return 0;
  }
  return defaultHoursForDate(dateOrKey, settings).target;
}

export function targetForDay(day, settings = DEFAULT_SETTINGS) {
  if (!day) return 0;
  if (day.type === 'holiday') return 0;
  return baseTargetForDate(day.date, settings);
}

export function allowsWork(type) {
  return ['work', 'homeOffice', 'businessTrip', 'halfVacation', 'doctor', 'other'].includes(type);
}

export function calculatedBreak(day, settings = DEFAULT_SETTINGS) {
  if (!day || !allowsWork(day.type)) return 0;
  const presence = durationMinutes(day.start, day.end);
  if (!presence) return 0;

  if (day.manualBreak) {
    return clampNumber(day.breakMinutes, 0, presence, 0);
  }

  const breakAfter = settings?.breakAfterMinutes ?? 360;
  const standardBreak = settings?.breakMinutes ?? 30;
  return presence >= breakAfter ? clampNumber(standardBreak, 0, presence, 0) : 0;
}

export function workedMinutes(day, settings = DEFAULT_SETTINGS) {
  if (!day || !allowsWork(day.type)) return 0;
  if (day.type === 'doctor' && day.doctorFullDay) return 0;

  const presence = durationMinutes(day.start, day.end);
  let absenceInsidePresence = 0;

  if (day.type === 'doctor' && day.doctorStart && day.doctorEnd) {
    absenceInsidePresence = overlapMinutes(day.start, day.end, day.doctorStart, day.doctorEnd);
  }

  return Math.max(0, presence - calculatedBreak(day, settings) - absenceInsidePresence);
}

export function creditedMinutes(day, settings = DEFAULT_SETTINGS) {
  if (!day) return 0;
  const target = targetForDay(day, settings);

  // KROK K ŘEŠENÍ CHYBY Z REVIZE:
  // Pokud je denní cíl 0 (víkend, svátek, nepracovní den), nesmí volba absence/dovolené/lékaře
  // automaticky generovat kladný omluvený čas a vytvářet falešné kladné saldo!
  if (target <= 0) {
    return 0;
  }

  switch (day.type) {
    case 'vacation':
      return target;
    case 'halfVacation':
      return Math.round(target / 2);
    case 'sick':
      return target;
    case 'compTime':
      return target;
    case 'doctor':
      return day.doctorFullDay ? target : Math.min(target, durationMinutes(day.doctorStart, day.doctorEnd));
    case 'other':
      return Math.min(target, Math.max(0, Number(day.otherMinutes) || 0));
    default:
      return 0;
  }
}

export function dayMetrics(day, settings = DEFAULT_SETTINGS) {
  const target = targetForDay(day, settings);
  const worked = workedMinutes(day, settings);
  const credited = creditedMinutes(day, settings);
  const counted = worked + credited;
  const balance = counted - target;
  const breakMin = calculatedBreak(day, settings);

  return {
    target,
    worked,
    credited,
    counted,
    balance,
    breakMinutes: breakMin
  };
}

export function monthStats(monthDate, recordsMap, settings = DEFAULT_SETTINGS) {
  const d = monthDate instanceof Date ? monthDate : parseDateKey(monthDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = localDateKey(new Date());

  let fund = 0;
  let worked = 0;
  let credited = 0;
  let balance = 0;
  let recorded = 0;
  let missing = 0;
  let scheduledWorkdays = 0;
  let weekendWorked = 0;
  let totalBreaks = 0;

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dateObj = new Date(year, month, dayNum, 12, 0, 0, 0);
    const key = localDateKey(dateObj);
    const baseTarget = baseTargetForDate(key, settings);

    if (baseTarget > 0) {
      scheduledWorkdays++;
    }

    const rec = recordsMap instanceof Map ? recordsMap.get(key) : recordsMap?.[key];
    fund += rec ? targetForDay(rec, settings) : baseTarget;

    if (rec) {
      const m = dayMetrics(rec, settings);
      worked += m.worked;
      credited += m.credited;
      balance += m.balance;
      totalBreaks += m.breakMinutes;
      recorded++;
      if (isWeekendDate(dateObj)) {
        weekendWorked += m.worked;
      }
    } else if (baseTarget > 0 && key < today) {
      missing++;
    }
  }

  return {
    fund,
    worked,
    credited,
    balance,
    recorded,
    missing,
    scheduledWorkdays,
    weekendWorked,
    totalBreaks
  };
}

export function yearVacationUsed(year, recordsMap) {
  let used = 0;
  const prefix = `${year}-`;
  const entries = recordsMap instanceof Map ? recordsMap.entries() : Object.entries(recordsMap || {});

  for (const [key, day] of entries) {
    if (!key.startsWith(prefix) || !day) continue;
    if (day.type === 'vacation') used += 1;
    else if (day.type === 'halfVacation') used += 0.5;
  }
  return used;
}

export function monthVacationDays(monthDate, recordsMap) {
  const d = monthDate instanceof Date ? monthDate : parseDateKey(monthDate);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const prefix = `${y}-${m}-`;
  let used = 0;

  const entries = recordsMap instanceof Map ? recordsMap.entries() : Object.entries(recordsMap || {});
  for (const [key, day] of entries) {
    if (!key.startsWith(prefix) || !day) continue;
    if (day.type === 'vacation') used += 1;
    else if (day.type === 'halfVacation') used += 0.5;
  }
  return used;
}

export function statusClassForDay(key, rec, settings = DEFAULT_SETTINGS, today = localDateKey(new Date())) {
  const date = parseDateKey(key);
  if (rec) {
    if (rec.type === 'doctor' || rec.type === 'sick') return 'doctor';
    if (rec.type === 'homeOffice') return 'home';
    if (rec.type === 'businessTrip') return 'trip';
    if (['vacation', 'halfVacation', 'holiday', 'compTime', 'other'].includes(rec.type)) return 'leave';
    if (isWeekendDate(date)) return 'weekend-work';
    return 'work';
  }
  if (isPublicHoliday(key)) return 'leave';
  if (baseTargetForDate(key, settings) > 0 && key < today) return 'missing';
  return '';
}

export function formatVacationDays(n) {
  if (n === 1) return '1 den';
  if (n >= 2 && n <= 4) return `${n} dny`;
  return `${Number(n).toLocaleString('cs-CZ')} dnů`;
}

export function normalizeSettings(raw) {
  const merged = { ...cloneDeep(DEFAULT_SETTINGS), ...(raw || {}), id: 'settings' };
  if (!Array.isArray(merged.workDays) || merged.workDays.length === 0) {
    if (merged.weekendMode === 'saturday') merged.workDays = [1, 2, 3, 4, 5, 6];
    else if (merged.weekendMode === 'sunday') merged.workDays = [1, 2, 3, 4, 5, 0];
    else if (merged.weekendMode === 'both') merged.workDays = [1, 2, 3, 4, 5, 6, 0];
    else merged.workDays = [1, 2, 3, 4, 5];
  } else {
    merged.workDays = merged.workDays.map(Number);
  }
  merged.workWeekends = merged.workDays.includes(6) || merged.workDays.includes(0);
  return merged;
}
