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

/** Round a wall-clock attendance input, without moving its calendar date.
 * The last two minutes of a day use 23:55 rather than an ambiguous 00:00.
 */
export function roundAttendanceTime(value) {
  const minutes = timeToMinutes(value);
  if (minutes === null) return value;
  return minutesToTime(Math.min(1435, Math.round(minutes / 5) * 5));
}

/** Only round newly entered or changed endpoints; preserve legacy times and notes.
 * If rounding against an unchanged, precise endpoint would reverse a short
 * shift into an overnight shift, use the adjacent five-minute slot instead.
 */
export function roundAttendanceTimes(day, previous = {}) {
  const startChanged = day.start !== previous?.start;
  const endChanged = day.end !== previous?.end;
  let start = startChanged ? roundAttendanceTime(day.start) : day.start;
  let end = endChanged ? roundAttendanceTime(day.end) : day.end;
  const rawStart = timeToMinutes(day.start);
  const rawEnd = timeToMinutes(day.end);
  const roundedStart = timeToMinutes(start);
  const roundedEnd = timeToMinutes(end);

  if (rawStart !== null && rawEnd !== null && rawEnd >= rawStart &&
      roundedEnd !== null && roundedStart !== null && roundedEnd < roundedStart) {
    if (endChanged && roundedStart <= 1435) {
      end = minutesToTime(Math.ceil(roundedStart / 5) * 5);
    } else if (startChanged) {
      start = minutesToTime(Math.floor(roundedEnd / 5) * 5);
    } else if (endChanged) {
      // An unchanged 23:56–23:59 arrival has no later slot on this date.
      end = day.end;
    }
  }

  return { ...day, start, end };
}

export const ATTENDANCE_HOURS = Object.freeze(Array.from({ length: 24 }, (_, i) => pad(i)));
export const ATTENDANCE_MINUTES = Object.freeze(Array.from({ length: 12 }, (_, i) => pad(i * 5)));

export function isAttendanceTimeSlot(time) {
  const minutes = timeToMinutes(time);
  return minutes !== null && minutes % 5 === 0;
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


/** Number of seconds elapsed since a local calendar date and wall-clock start (also across midnight). */
export function shiftElapsedSeconds(dateKey, startTime, now = new Date()) {
  const start = timeToMinutes(startTime);
  if (start === null || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return 0;
  const [year, month, day] = dateKey.split('-').map(Number);
  const startedAt = new Date(year, month - 1, day, Math.floor(start / 60), start % 60);
  if (startedAt.getFullYear() !== year || startedAt.getMonth() !== month - 1 || startedAt.getDate() !== day) return 0;
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
}

/** Estimate a shift's net target consistently with the automatic break rule. */
export function calculateNetScheduleMinutes(start, end, breakMinutes, breakAfterMinutes = 360) {
  const presence = durationMinutes(start, end);
  if (presence <= 0) return 0;
  const automaticBreak = presence >= breakAfterMinutes
    ? Math.min(presence, Math.max(0, Number(breakMinutes) || 0))
    : 0;
  return Math.max(0, presence - automaticBreak);
}
