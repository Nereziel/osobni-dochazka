/**
 * Pomocné funkce pro práci s časem a minutami
 */

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function timeToMinutes(v) {
  if (!v || typeof v !== 'string') return null;
  const match = v.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function minutesToTime(min) {
  if (!Number.isFinite(min)) return '00:00';
  min = Math.max(0, Math.round(min));
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}

export function durationMinutes(start, end) {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return 0;
  return e >= s ? e - s : (1440 - s) + e;
}

export function timeIntervals(start, end) {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null || s === e) return [];
  return e > s ? [[s, e]] : [[s, 1440], [0, e]];
}

export function overlapMinutes(startA, endA, startB, endB) {
  let total = 0;
  for (const [a1, a2] of timeIntervals(startA, endA)) {
    for (const [b1, b2] of timeIntervals(startB, endB)) {
      total += Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
    }
  }
  return total;
}

export function formatDuration(min, signed = false) {
  if (!Number.isFinite(min)) return '0:00';
  const rounded = Math.round(min);
  const sign = rounded < 0 ? '−' : (signed && rounded > 0 ? '+' : '');
  const a = Math.abs(rounded);
  return `${sign}${Math.floor(a / 60)}:${pad(a % 60)}`;
}

export function formatClock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

