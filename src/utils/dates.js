/**
 * Pomocné funkce pro práci s daty a kalendářem
 * Všechna data jsou reprezentována jako YYYY-MM-DD bez závislosti na UTC časovém posunu.
 */
import { pad } from './time.js';

export function localDateKey(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(key) {
  if (!key || typeof key !== 'string') return new Date();
  const [y, m, d] = key.split('-').map(Number);
  // Používáme poledne (12:00:00) v lokálním čase pro eliminaci posunů při letním/zimním čase
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function startOfMonth(date) {
  const d = date instanceof Date ? date : parseDateKey(date);
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
}

export function addMonths(date, delta) {
  const d = date instanceof Date ? date : parseDateKey(date);
  return new Date(d.getFullYear(), d.getMonth() + delta, 1, 12, 0, 0, 0);
}

export function todayKey() {
  return localDateKey(new Date());
}

export function isSameMonth(a, b) {
  const da = a instanceof Date ? a : parseDateKey(a);
  const db = b instanceof Date ? b : parseDateKey(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
}

export function isWeekendDate(dateOrKey) {
  if (!dateOrKey) return false;
  let d;
  if (typeof dateOrKey === 'string') {
    d = parseDateKey(dateOrKey);
  } else if (dateOrKey instanceof Date) {
    d = dateOrKey;
  } else {
    return false;
  }
  if (!d || isNaN(d.getTime())) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function fmtDayFull(date) {
  const d = typeof date === 'string' ? parseDateKey(date) : date;
  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(d);
}

export function fmtDayShort(date) {
  const d = typeof date === 'string' ? parseDateKey(date) : date;
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(d);
}

export function fmtWeekdayShort(date) {
  const d = typeof date === 'string' ? parseDateKey(date) : date;
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' }).format(d);
}

export function fmtMonthTitle(date) {
  const d = typeof date === 'string' ? parseDateKey(date) : date;
  const text = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(d);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const MONTH_NAMES_CS = [
  'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
];

