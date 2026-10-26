/**
 * Validace uživatelských a docházkových dat
 */

export function isValidTimeString(val) {
  if (typeof val !== 'string') return false;
  const match = val.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidDateKey(val) {
  if (typeof val !== 'string') return false;
  const match = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isValidUsername(val) {
  if (typeof val !== 'string') return false;
  const clean = val.trim().toLowerCase();
  return /^[a-z0-9._-]{3,30}$/.test(clean);
}

export function isValidPin(val) {
  if (typeof val !== 'string') return false;
  return val.length >= 4;
}

export function isValidInviteCode(val) {
  if (typeof val !== 'string') return false;
  const clean = val.trim().toUpperCase();
  return clean.length >= 6 && /^INV-[A-Z0-9]+$/.test(clean);
}

export function clampNumber(v, min, max, defaultVal = min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.min(max, Math.max(min, n));
}

export function cloneDeep(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return Array.isArray(obj) ? [...obj] : { ...obj };
  }
}


