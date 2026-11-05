import { DEFAULT_SETTINGS, TYPE_LABELS, normalizeSettings } from './attendance.js';
import { isValidDateKey, isValidTimeString } from './validation.js';
import { dayRowForSupabase, profileRowFromSettings } from '../services/sync.js';

const MAX_BACKUP_DAYS = 5000;
const NUMERIC_SETTINGS = {
  dailyTargetMinutes: 1440,
  breakMinutes: 240,
  breakAfterMinutes: 1440,
  weekendTargetMinutes: 1440
};
const TIME_SETTINGS = ['workStart', 'workEnd', 'weekendStart', 'weekendEnd'];
const BOOLEAN_SETTINGS = ['autoFill', 'workWeekends', 'weekendCustomHours', 'workOnHolidays'];
const VALID_WEEKEND_MODES = ['none', 'saturday', 'sunday', 'both', 'custom'];
const VALID_THEMES = ['system', 'light', 'dark'];

function validTimeOrEmpty(value) {
  return typeof value === 'string' && (value === '' || isValidTimeString(value));
}

function validInteger(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function normalizeBackupDay(raw, index, updatedAt) {
  const number = index + 1;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !isValidDateKey(raw.date)) {
    throw new Error(`Neplatné datum na řádku zálohy ${number}.`);
  }
  const type = raw.type || 'work';
  if (!Object.hasOwn(TYPE_LABELS, type)) {
    throw new Error(`Neznámý typ dne v záloze (${raw.date}).`);
  }
  const start = raw.start ?? '';
  const end = raw.end ?? '';
  const doctorStart = raw.doctorStart ?? '';
  const doctorEnd = raw.doctorEnd ?? '';
  if (![start, end, doctorStart, doctorEnd].every(validTimeOrEmpty) ||
      (!start && end) || (!!doctorStart !== !!doctorEnd) ||
      (start && end && start === end)) {
    throw new Error(`Neplatný čas v záloze (${raw.date}).`);
  }
  const manualBreak = raw.manualBreak ?? false;
  const doctorFullDay = raw.doctorFullDay ?? false;
  const breakMinutes = raw.breakMinutes ?? 30;
  const otherMinutes = raw.otherMinutes ?? 0;
  const note = raw.note ?? '';
  if (typeof manualBreak !== 'boolean' || typeof doctorFullDay !== 'boolean' ||
      !validInteger(breakMinutes, 240) || !validInteger(otherMinutes, 1440) ||
      typeof note !== 'string' || note.length > 2000) {
    throw new Error(`Neplatné hodnoty dne v záloze (${raw.date}).`);
  }
  return {
    date: raw.date, type, start, end, manualBreak, breakMinutes,
    doctorFullDay, doctorStart, doctorEnd, otherMinutes, note, updatedAt
  };
}

function normalizeBackupSettings(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Nastavení v záloze musí být objekt.');
  }
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.hasOwn(NUMERIC_SETTINGS, key)) {
      if (!validInteger(value, NUMERIC_SETTINGS[key])) throw new Error(`Neplatné nastavení: ${key}.`);
      clean[key] = value;
    } else if (TIME_SETTINGS.includes(key)) {
      if (!isValidTimeString(value)) throw new Error(`Neplatný čas v nastavení: ${key}.`);
      clean[key] = value;
    } else if (BOOLEAN_SETTINGS.includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`Neplatné nastavení: ${key}.`);
      clean[key] = value;
    } else if (key === 'workDays') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 7 ||
          new Set(value).size !== value.length ||
          !value.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
        throw new Error('Neplatné pracovní dny v záloze.');
      }
      clean.workDays = value;
    } else if (key === 'weekendMode') {
      if (!VALID_WEEKEND_MODES.includes(value)) throw new Error('Neplatný víkendový režim.');
      clean.weekendMode = value;
    } else if (key === 'theme') {
      if (!VALID_THEMES.includes(value)) throw new Error('Neplatný motiv.');
      clean.theme = value;
    }
    // Unknown and security-sensitive fields are intentionally ignored.
  }
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...clean });
}

export function validateBackupPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !Array.isArray(payload.days) || payload.days.length > MAX_BACKUP_DAYS ||
      (payload.app && payload.app !== 'osobni-dochazka-win11')) {
    throw new Error('Soubor není platná záloha docházky nebo je příliš velký.');
  }

  const now = new Date().toISOString();
  const days = [];
  const seen = new Set();
  for (const [index, raw] of payload.days.entries()) {
    const day = normalizeBackupDay(raw, index, now);
    if (seen.has(day.date)) throw new Error(`Duplicitní den v záloze: ${day.date}.`);
    seen.add(day.date);
    days.push(day);
  }
  const settings = normalizeBackupSettings(payload.settings);
  return { days, settings };
}

/** Builds queued cloud writes before opening the single IndexedDB restore transaction. */
export function buildBackupSyncActions(days, importedSettings, user, existingSettings = DEFAULT_SETTINGS) {
  if (!user?.userKey) return [];
  const settings = importedSettings || existingSettings;
  const items = [];
  if (importedSettings) {
    items.push({
      entity: 'attendance_profiles',
      action: 'UPDATE',
      payload: profileRowFromSettings(settings, user)
    });
  }
  for (const day of days) {
    items.push({
      entity: 'attendance_days',
      action: 'UPSERT',
      payload: dayRowForSupabase(day, user.userKey, settings)
    });
  }
  return items;
}
