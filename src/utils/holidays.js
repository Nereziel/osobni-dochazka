/**
 * České státní svátky a dny pracovního klidu (včetně pohyblivých Velikonoc)
 */
import { localDateKey, parseDateKey } from './dates.js';

export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function czechHolidayMap(year) {
  const map = new Map([
    [`${year}-01-01`, 'Nový rok / Den obnovy samostatného českého státu'],
    [`${year}-05-01`, 'Svátek práce'],
    [`${year}-05-08`, 'Den vítězství'],
    [`${year}-07-05`, 'Den slovanských věrozvěstů Cyrila a Metoděje'],
    [`${year}-07-06`, 'Den upálení mistra Jana Husa'],
    [`${year}-09-28`, 'Den české státnosti'],
    [`${year}-10-28`, 'Den vzniku samostatného československého státu'],
    [`${year}-11-17`, 'Den boje za svobodu a demokracii'],
    [`${year}-12-24`, 'Štědrý den'],
    [`${year}-12-25`, '1. svátek vánoční'],
    [`${year}-12-26`, '2. svátek vánoční']
  ]);

  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);

  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);

  map.set(localDateKey(goodFriday), 'Velký pátek');
  map.set(localDateKey(easterMonday), 'Velikonoční pondělí');

  return map;
}

export function holidayName(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '';
  const year = parseDateKey(dateKey).getFullYear();
  return czechHolidayMap(year).get(dateKey) || '';
}

export function isPublicHoliday(dateKey) {
  return Boolean(holidayName(dateKey));
}

