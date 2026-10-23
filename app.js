(() => {
  'use strict';

  // ============================================================================
  // KONFIGURACE SPOLEČNÉ SUPABASE DATABÁZE
  // Při nasazení na GitHub Pages přes GitHub Actions se klíče automaticky načtou
  // z GitHub Secrets (SUPABASE_URL a SUPABASE_ANON_KEY) do souboru config.js.
  // ============================================================================
  const DEFAULT_SUPABASE_CONFIG = {
    url: window.DOCHAZKA_CONFIG?.supabaseUrl || '',
    anonKey: window.DOCHAZKA_CONFIG?.supabaseAnonKey || ''
  };

  const DB_NAME = 'osobni-dochazka';
  const DB_VERSION = 2;
  const LS_SUPABASE_KEY = 'dochazka_supabase_config_v1';
  const LS_USER_KEY = 'dochazka_active_user_v1';

  const DEFAULT_SETTINGS = {
    id: 'settings',
    workStart: '06:30',
    workEnd: '15:30',
    dailyTargetMinutes: 510, // 8:30
    breakMinutes: 30,
    breakAfterMinutes: 360,  // 6:00
    autoFill: true,
    // Víkendy a pracovní dny (1=Po, 2=Út, 3=St, 4=Čt, 5=Pá, 6=So, 0=Ne)
    workDays: [1, 2, 3, 4, 5],
    workWeekends: false,
    weekendMode: 'none', // 'none' | 'saturday' | 'sunday' | 'both' | 'custom'
    weekendCustomHours: false,
    weekendStart: '07:00',
    weekendEnd: '15:30',
    weekendTargetMinutes: 480, // 8:00
    workOnHolidays: false,
    vacationAllowanceDays: 20,
    theme: 'system'
  };

  const TYPE_LABELS = {
    work: 'Práce',
    homeOffice: 'Home office',
    businessTrip: 'Služební cesta',
    vacation: 'Dovolená',
    halfVacation: '½ dovolené',
    doctor: 'Lékař',
    sick: 'Nemoc',
    holiday: 'Svátek / volno',
    compTime: 'Náhradní volno',
    other: 'Jiné volno'
  };

  const SHORT_TYPE_LABELS = {
    work: 'Práce',
    homeOffice: 'HO',
    businessTrip: 'Cesta',
    vacation: 'Dovol.',
    halfVacation: '½ dov.',
    doctor: 'Lékař',
    sick: 'Nemoc',
    holiday: 'Volno',
    compTime: 'Náhr.',
    other: 'Jiné'
  };

  const SQL_SCHEMA_TEXT = `-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – DATABÁZE PRO SUPABASE (PostgreSQL)
-- Spusť tento skript v Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.attendance_profiles (
  user_key text primary key,
  username text not null unique,
  display_name text not null default '',
  pin_hash text not null default '',
  work_start text not null default '06:30',
  work_end text not null default '15:30',
  daily_target_minutes integer not null default 510 check (daily_target_minutes between 0 and 1440),
  break_minutes integer not null default 30 check (break_minutes between 0 and 240),
  break_after_minutes integer not null default 360 check (break_after_minutes between 0 and 1440),
  auto_fill boolean not null default true,
  work_days integer[] not null default '{1,2,3,4,5}',
  work_weekends boolean not null default false,
  weekend_mode text not null default 'none' check (weekend_mode in ('none', 'saturday', 'sunday', 'both', 'custom')),
  weekend_custom_hours boolean not null default false,
  weekend_start text not null default '07:00',
  weekend_end text not null default '15:30',
  weekend_target_minutes integer not null default 480 check (weekend_target_minutes between 0 and 1440),
  work_on_holidays boolean not null default false,
  vacation_allowance_days numeric(4,1) not null default 20.0,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  user_key text not null references public.attendance_profiles(user_key) on delete cascade,
  date date not null,
  type text not null default 'work' check (
    type in ('work','homeOffice','businessTrip','vacation','halfVacation','doctor','sick','holiday','compTime','other')
  ),
  start_time text not null default '',
  end_time text not null default '',
  manual_break boolean not null default false,
  break_minutes integer not null default 30,
  doctor_full_day boolean not null default false,
  doctor_start text not null default '',
  doctor_end text not null default '',
  other_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  credited_minutes integer not null default 0,
  target_minutes integer not null default 0,
  balance_minutes integer not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_key, date)
);

create index if not exists idx_attendance_days_user_date
  on public.attendance_days (user_key, date desc);

create or replace function public.req_user_key()
returns text language sql stable as $$
  select coalesce(nullif(split_part(current_setting('request.headers', true)::json->>'x-client-info', '|', 2), ''), '');
$$;

create or replace function public.req_pin_hash()
returns text language sql stable as $$
  select coalesce(nullif(split_part(current_setting('request.headers', true)::json->>'x-client-info', '|', 3), ''), '');
$$;

alter table public.attendance_profiles enable row level security;
alter table public.attendance_days enable row level security;

drop policy if exists "Secure access to own profile" on public.attendance_profiles;
create policy "Secure access to own profile"
  on public.attendance_profiles for all to anon, authenticated
  using (user_key = public.req_user_key() and pin_hash = public.req_pin_hash())
  with check (user_key = public.req_user_key() and pin_hash = public.req_pin_hash());

drop policy if exists "Secure access to own attendance days" on public.attendance_days;
create policy "Secure access to own attendance days"
  on public.attendance_days for all to anon, authenticated
  using (
    user_key = public.req_user_key()
    and exists (select 1 from public.attendance_profiles p where p.user_key = attendance_days.user_key and p.pin_hash = public.req_pin_hash())
  )
  with check (
    user_key = public.req_user_key()
    and exists (select 1 from public.attendance_profiles p where p.user_key = attendance_days.user_key and p.pin_hash = public.req_pin_hash())
  );`;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let db;
  let settings = structuredClone(DEFAULT_SETTINGS);
  let records = new Map();
  let calendarMonth = startOfMonth(new Date());
  let overviewMonth = startOfMonth(new Date());
  let editingOriginal = null;
  let toastTimer;
  let activeShiftInterval = null;

  let supabaseConfig = loadSupabaseConfig();
  let currentUser = loadCurrentUser();
  let syncState = 'local'; // 'local' | 'online' | 'syncing' | 'error'

  // ============================================================================
  // POMOCNÉ FUNKCE PRO DATUM A ČAS
  // ============================================================================
  function pad(n) { return String(n).padStart(2, '0'); }
  function localDateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1, 12); }
  function addMonths(date, delta) { return new Date(date.getFullYear(), date.getMonth() + delta, 1, 12); }
  function todayKey() { return localDateKey(new Date()); }
  function isSameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
  function isWeekendDate(date) { const d = date.getDay(); return d === 0 || d === 6; }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function timeToMinutes(v) {
    if (!v || !/^\d{2}:\d{2}$/.test(v)) return null;
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  }

  function durationMinutes(start, end) {
    const s = timeToMinutes(start), e = timeToMinutes(end);
    if (s === null || e === null) return 0;
    return e >= s ? e - s : (1440 - s) + e;
  }

  function timeIntervals(start, end) {
    const s = timeToMinutes(start), e = timeToMinutes(end);
    if (s === null || e === null || s === e) return [];
    return e > s ? [[s, e]] : [[s, 1440], [0, e]];
  }

  function overlapMinutes(startA, endA, startB, endB) {
    let total = 0;
    for (const [a1, a2] of timeIntervals(startA, endA)) {
      for (const [b1, b2] of timeIntervals(startB, endB)) {
        total += Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
      }
    }
    return total;
  }

  function minutesToTime(min) {
    min = Math.max(0, Math.round(min));
    return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  }

  function formatDuration(min, signed = false) {
    if (!Number.isFinite(min)) return '0:00';
    const rounded = Math.round(min);
    const sign = rounded < 0 ? '−' : (signed && rounded > 0 ? '+' : '');
    const a = Math.abs(rounded);
    return `${sign}${Math.floor(a / 60)}:${pad(a % 60)}`;
  }

  function formatClock(date = new Date()) { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }
  function fmtDay(date) { return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' }).format(date); }
  function fmtDayShort(date) { return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(date); }
  function fmtWeekdayShort(date) { return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' }).format(date); }
  function fmtMonth(date) { return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(date); }

  // ============================================================================
  // ČESKÉ STÁTNÍ SVÁTKY (VČETNĚ VELIKONOC)
  // ============================================================================
  function easterSunday(year) {
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
    return new Date(year, month - 1, day, 12);
  }

  function czechHolidayMap(year) {
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
    const goodFriday = new Date(easter); goodFriday.setDate(easter.getDate() - 2);
    const easterMonday = new Date(easter); easterMonday.setDate(easter.getDate() + 1);
    map.set(localDateKey(goodFriday), 'Velký pátek');
    map.set(localDateKey(easterMonday), 'Velikonoční pondělí');
    return map;
  }

  function holidayName(key) { return czechHolidayMap(parseDateKey(key).getFullYear()).get(key) || ''; }
  function isPublicHoliday(key) { return !!holidayName(key); }

  // ============================================================================
  // ROZVRH PRACOVNÍ DOBY, VÍKENDŮ A VÝPOČET METRIK DNE
  // ============================================================================
  function activeWorkDays() {
    if (Array.isArray(settings.workDays) && settings.workDays.length > 0) {
      return settings.workDays.map(Number);
    }
    return [1, 2, 3, 4, 5];
  }

  function isScheduledWorkday(dateOrKey) {
    const date = typeof dateOrKey === 'string' ? parseDateKey(dateOrKey) : dateOrKey;
    const key = typeof dateOrKey === 'string' ? dateOrKey : localDateKey(date);
    if (isPublicHoliday(key) && !settings.workOnHolidays) return false;
    return activeWorkDays().includes(date.getDay());
  }

  function defaultHoursForDate(key) {
    const date = parseDateKey(key);
    if (isWeekendDate(date) && settings.weekendCustomHours) {
      return {
        start: settings.weekendStart || settings.workStart,
        end: settings.weekendEnd || settings.workEnd,
        target: Number.isFinite(settings.weekendTargetMinutes) ? settings.weekendTargetMinutes : settings.dailyTargetMinutes
      };
    }
    return {
      start: settings.workStart,
      end: settings.workEnd,
      target: settings.dailyTargetMinutes
    };
  }

  function baseTargetForDate(key) {
    if (!isScheduledWorkday(key)) return 0;
    return defaultHoursForDate(key).target;
  }

  function targetForDay(day) {
    if (!day) return 0;
    if (day.type === 'holiday') return 0;
    return baseTargetForDate(day.date);
  }

  function allowsWork(type) {
    return ['work', 'homeOffice', 'businessTrip', 'halfVacation', 'doctor', 'other'].includes(type);
  }

  function calculatedBreak(day) {
    if (!day || !allowsWork(day.type)) return 0;
    const presence = durationMinutes(day.start, day.end);
    if (!presence) return 0;
    if (day.manualBreak) return clamp(Number(day.breakMinutes) || 0, 0, presence);
    return presence >= settings.breakAfterMinutes ? clamp(settings.breakMinutes, 0, presence) : 0;
  }

  function workedMinutes(day) {
    if (!day || !allowsWork(day.type)) return 0;
    if (day.type === 'doctor' && day.doctorFullDay) return 0;
    const presence = durationMinutes(day.start, day.end);
    let absenceInsidePresence = 0;
    if (day.type === 'doctor' && day.doctorStart && day.doctorEnd) {
      absenceInsidePresence = overlapMinutes(day.start, day.end, day.doctorStart, day.doctorEnd);
    }
    return Math.max(0, presence - calculatedBreak(day) - absenceInsidePresence);
  }

  function creditedMinutes(day) {
    if (!day) return 0;
    const target = targetForDay(day);
    const fallbackTarget = defaultHoursForDate(day.date).target;
    const effTarget = target > 0 ? target : fallbackTarget;
    switch (day.type) {
      case 'vacation': return target;
      case 'halfVacation': return Math.round(effTarget / 2);
      case 'sick': return target;
      case 'compTime': return target;
      case 'doctor': return day.doctorFullDay ? target : durationMinutes(day.doctorStart, day.doctorEnd);
      case 'other': return Math.max(0, Number(day.otherMinutes) || 0);
      default: return 0;
    }
  }

  function dayMetrics(day) {
    const target = targetForDay(day);
    const worked = workedMinutes(day);
    const credited = creditedMinutes(day);
    return {
      target,
      worked,
      credited,
      counted: worked + credited,
      balance: worked + credited - target,
      breakMinutes: calculatedBreak(day)
    };
  }

  function defaultDay(key) {
    const scheduled = isScheduledWorkday(key);
    const hours = defaultHoursForDate(key);
    if (!scheduled) {
      return {
        date: key,
        type: isPublicHoliday(key) ? 'holiday' : 'work',
        start: settings.autoFill ? hours.start : '',
        end: settings.autoFill ? hours.end : '',
        manualBreak: false,
        breakMinutes: settings.breakMinutes,
        doctorFullDay: false,
        doctorStart: '',
        doctorEnd: '',
        otherMinutes: 0,
        note: ''
      };
    }
    return {
      date: key,
      type: 'work',
      start: settings.autoFill ? hours.start : '',
      end: settings.autoFill ? hours.end : '',
      manualBreak: false,
      breakMinutes: settings.breakMinutes,
      doctorFullDay: false,
      doctorStart: '',
      doctorEnd: '',
      otherMinutes: 0,
      note: ''
    };
  }

  // ============================================================================
  // LOKÁLNÍ INDEXEDDB ÚLOŽIŠTĚ
  // ============================================================================
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('days')) d.createObjectStore('days', { keyPath: 'date' });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idb(store, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const st = tx.objectStore(store);
      const req = action(st);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function normalizeSettings(raw) {
    const merged = { ...structuredClone(DEFAULT_SETTINGS), ...(raw || {}), id: 'settings' };
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

  async function loadData() {
    const storedSettings = await idb('settings', 'readonly', s => s.get('settings'));
    settings = normalizeSettings(storedSettings);
    const days = await idb('days', 'readonly', s => s.getAll());
    records = new Map(days.map(d => [d.date, d]));
    applyTheme();
  }

  async function saveDay(day, skipCloud = false) {
    day.updatedAt = new Date().toISOString();
    await idb('days', 'readwrite', s => s.put(day));
    records.set(day.date, day);
    renderAll();
    if (!skipCloud && isCloudReady()) {
      pushDayToSupabase(day).catch(err => {
        console.warn('Cloud sync dne selhal:', err);
        setSyncState('error');
      });
    }
  }

  async function deleteDay(key, skipCloud = false) {
    await idb('days', 'readwrite', s => s.delete(key));
    records.delete(key);
    renderAll();
    if (!skipCloud && isCloudReady()) {
      deleteDayFromSupabase(key).catch(err => {
        console.warn('Smazání dne v cloudu selhalo:', err);
        setSyncState('error');
      });
    }
  }

  async function saveSettings(skipCloud = false) {
    settings = normalizeSettings(settings);
    await idb('settings', 'readwrite', s => s.put(settings));
    if (!skipCloud && isCloudReady()) {
      pushProfileToSupabase().catch(err => {
        console.warn('Uložení nastavení do cloudu selhalo:', err);
        setSyncState('error');
      });
    }
  }

  // ============================================================================
  // SUPABASE CLOUD & JEDNODUCHÝ LOGIN (JMÉNO + PIN/HESLO)
  // ============================================================================
  function loadSupabaseConfig() {
    try {
      const params = new URLSearchParams(location.search);
      const urlParam = params.get('sb_url');
      const keyParam = params.get('sb_key');
      if (urlParam && keyParam) {
        const cfg = { url: urlParam.trim().replace(/\/+$/, ''), anonKey: keyParam.trim() };
        localStorage.setItem(LS_SUPABASE_KEY, JSON.stringify(cfg));
        history.replaceState({}, document.title, location.pathname);
        return cfg;
      }
      const saved = JSON.parse(localStorage.getItem(LS_SUPABASE_KEY) || 'null');
      if (saved && saved.url && saved.anonKey) {
        return { url: saved.url.trim().replace(/\/+$/, ''), anonKey: saved.anonKey.trim() };
      }
    } catch (e) {
      console.warn(e);
    }
    if (DEFAULT_SUPABASE_CONFIG.url && DEFAULT_SUPABASE_CONFIG.anonKey) {
      return {
        url: DEFAULT_SUPABASE_CONFIG.url.trim().replace(/\/+$/, ''),
        anonKey: DEFAULT_SUPABASE_CONFIG.anonKey.trim()
      };
    }
    return { url: '', anonKey: '' };
  }

  function saveSupabaseConfigToStorage(url, anonKey) {
    supabaseConfig = {
      url: (url || '').trim().replace(/\/+$/, ''),
      anonKey: (anonKey || '').trim()
    };
    if (supabaseConfig.url && supabaseConfig.anonKey) {
      localStorage.setItem(LS_SUPABASE_KEY, JSON.stringify(supabaseConfig));
    } else {
      localStorage.removeItem(LS_SUPABASE_KEY);
    }
  }

  function loadCurrentUser() {
    try {
      return JSON.parse(localStorage.getItem(LS_USER_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function saveCurrentUser(user) {
    currentUser = user;
    if (user) localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LS_USER_KEY);
  }

  function isBuiltInSupabase() {
    return Boolean(DEFAULT_SUPABASE_CONFIG.url && DEFAULT_SUPABASE_CONFIG.anonKey);
  }

  function isSupabaseConfigured() {
    return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
  }

  function isCloudReady() {
    return Boolean(isSupabaseConfigured() && currentUser && currentUser.userKey);
  }

  function setSyncState(state) {
    syncState = state;
    renderAuthAndSyncUI();
  }

  async function hashPin(pin, username) {
    const raw = `dochazka:${username.toLowerCase().trim()}:${pin}`;
    if (crypto?.subtle?.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fnv:${(h >>> 0).toString(16)}`;
  }

  async function sbFetch(path, options = {}) {
    if (!isSupabaseConfigured()) throw new Error('Supabase databáze není nastavena.');
    const authUser = options.authUser || currentUser;
    const clientInfo = authUser?.userKey && authUser?.pinHash
      ? `dochazka-pwa|${authUser.userKey}|${authUser.pinHash}`
      : 'dochazka-pwa||';
    const headers = {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${supabaseConfig.anonKey}`,
      'X-Client-Info': clientInfo,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const res = await fetch(`${supabaseConfig.url}${path}`, {
      ...options,
      headers
    });
    if (!res.ok) {
      let detail = '';
      try {
        const errJson = await res.json();
        detail = errJson.message || errJson.error_description || errJson.hint || JSON.stringify(errJson);
      } catch {
        detail = await res.text();
      }
      const error = new Error(detail || `Chyba Supabase (${res.status})`);
      error.status = res.status;
      throw error;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function profileRowFromSettings(user) {
    return {
      user_key: user.userKey,
      username: user.username,
      display_name: user.displayName || user.username,
      pin_hash: user.pinHash || '',
      work_start: settings.workStart,
      work_end: settings.workEnd,
      daily_target_minutes: settings.dailyTargetMinutes,
      break_minutes: settings.breakMinutes,
      break_after_minutes: settings.breakAfterMinutes,
      auto_fill: !!settings.autoFill,
      work_days: activeWorkDays(),
      work_weekends: activeWorkDays().includes(6) || activeWorkDays().includes(0),
      weekend_mode: settings.weekendMode || 'none',
      weekend_custom_hours: !!settings.weekendCustomHours,
      weekend_start: settings.weekendStart || '07:00',
      weekend_end: settings.weekendEnd || '15:30',
      weekend_target_minutes: Number.isFinite(settings.weekendTargetMinutes) ? settings.weekendTargetMinutes : 480,
      work_on_holidays: !!settings.workOnHolidays,
      vacation_allowance_days: Number(settings.vacationAllowanceDays) || 20,
      theme: settings.theme || 'system',
      settings_json: settings
    };
  }

  function applySettingsFromProfileRow(row) {
    if (!row) return;
    settings = normalizeSettings({
      ...(row.settings_json || {}),
      id: 'settings',
      workStart: row.work_start || DEFAULT_SETTINGS.workStart,
      workEnd: row.work_end || DEFAULT_SETTINGS.workEnd,
      dailyTargetMinutes: Number.isFinite(row.daily_target_minutes) ? row.daily_target_minutes : DEFAULT_SETTINGS.dailyTargetMinutes,
      breakMinutes: Number.isFinite(row.break_minutes) ? row.break_minutes : DEFAULT_SETTINGS.breakMinutes,
      breakAfterMinutes: Number.isFinite(row.break_after_minutes) ? row.break_after_minutes : DEFAULT_SETTINGS.breakAfterMinutes,
      autoFill: row.auto_fill ?? true,
      workDays: Array.isArray(row.work_days) ? row.work_days.map(Number) : DEFAULT_SETTINGS.workDays,
      workWeekends: !!row.work_weekends,
      weekendMode: row.weekend_mode || 'none',
      weekendCustomHours: !!row.weekend_custom_hours,
      weekendStart: row.weekend_start || '07:00',
      weekendEnd: row.weekend_end || '15:30',
      weekendTargetMinutes: Number.isFinite(row.weekend_target_minutes) ? row.weekend_target_minutes : 480,
      workOnHolidays: !!row.work_on_holidays,
      vacationAllowanceDays: Number(row.vacation_allowance_days) || 20,
      theme: row.theme || 'system'
    });
  }

  function dayRowForSupabase(day) {
    const m = dayMetrics(day);
    return {
      user_key: currentUser.userKey,
      date: day.date,
      type: day.type || 'work',
      start_time: day.start || '',
      end_time: day.end || '',
      manual_break: !!day.manualBreak,
      break_minutes: Number(day.breakMinutes) || 0,
      doctor_full_day: !!day.doctorFullDay,
      doctor_start: day.doctorStart || '',
      doctor_end: day.doctorEnd || '',
      other_minutes: Number(day.otherMinutes) || 0,
      worked_minutes: m.worked,
      credited_minutes: m.credited,
      target_minutes: m.target,
      balance_minutes: m.balance,
      note: day.note || '',
      updated_at: day.updatedAt || new Date().toISOString()
    };
  }

  function localDayFromSupabaseRow(row) {
    return {
      date: row.date,
      type: row.type || 'work',
      start: row.start_time || '',
      end: row.end_time || '',
      manualBreak: !!row.manual_break,
      breakMinutes: Number.isFinite(row.break_minutes) ? row.break_minutes : settings.breakMinutes,
      doctorFullDay: !!row.doctor_full_day,
      doctorStart: row.doctor_start || '',
      doctorEnd: row.doctor_end || '',
      otherMinutes: Number(row.other_minutes) || 0,
      note: row.note || '',
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  async function pushProfileToSupabase() {
    if (!isCloudReady()) return;
    setSyncState('syncing');
    const row = profileRowFromSettings(currentUser);
    await sbFetch('/rest/v1/attendance_profiles?on_conflict=user_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row)
    });
    setSyncState('online');
  }

  async function pushDayToSupabase(day) {
    if (!isCloudReady()) return;
    setSyncState('syncing');
    const row = dayRowForSupabase(day);
    await sbFetch('/rest/v1/attendance_days?on_conflict=user_key,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row)
    });
    setSyncState('online');
  }

  async function deleteDayFromSupabase(dateKey) {
    if (!isCloudReady()) return;
    setSyncState('syncing');
    const q = `/rest/v1/attendance_days?user_key=eq.${encodeURIComponent(currentUser.userKey)}&date=eq.${encodeURIComponent(dateKey)}`;
    await sbFetch(q, { method: 'DELETE' });
    setSyncState('online');
  }

  async function testSupabaseConnection() {
    if (!isSupabaseConfigured()) throw new Error('Vyplň Supabase Project URL i Anon Key.');
    await sbFetch('/rest/v1/attendance_profiles?select=user_key&limit=1', { method: 'GET' });
    return true;
  }

  async function loginWithSimpleProfile(usernameInput, displayNameInput, pinInput, mergeLocal) {
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno (písmena/čísla).');
    if (!pinInput) throw new Error('Zadej svůj PIN nebo heslo.');

    const userKey = `user:${cleanUser}`;
    const pinHash = await hashPin(pinInput, cleanUser);
    const displayName = (displayNameInput || '').trim() || usernameInput.trim();
    const previousUserKey = currentUser?.userKey;

    if (isSupabaseConfigured()) {
      setSyncState('syncing');
      const candidateUser = {
        userKey,
        username: cleanUser,
        displayName,
        pinHash
      };
      const existingRows = await sbFetch(
        `/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(userKey)}&select=*`,
        { authUser: candidateUser }
      );
      const existing = existingRows?.[0] || null;

      if (existing) {
        saveCurrentUser({
          userKey,
          username: cleanUser,
          displayName: existing.display_name || displayName,
          pinHash
        });
        applySettingsFromProfileRow(existing);
        await saveSettings(true);
        applyTheme();
      } else {
        // Zkusíme založit nový profil; pokud už user_key existuje s jiným PINem, databáze vrátí 409 / 403
        try {
          const row = profileRowFromSettings(candidateUser);
          await sbFetch('/rest/v1/attendance_profiles', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(row),
            authUser: candidateUser
          });
          saveCurrentUser(candidateUser);
        } catch (err) {
          setSyncState('error');
          if (err.status === 409 || err.status === 403 || /duplicate|unique|policy/i.test(err.message)) {
            throw new Error(`Uživatel "${cleanUser}" již existuje a zadaný PIN / heslo nesouhlasí.`);
          }
          throw err;
        }
      }

      // Pokud se přihlásil jiný uživatel a nechce sloučit cizí lokální data, vyčistíme lokální dny před stažením
      if (!mergeLocal || (previousUserKey && previousUserKey !== userKey)) {
        const tx = db.transaction(['days'], 'readwrite');
        tx.objectStore('days').clear();
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        records.clear();
      }

      await syncWithSupabase(mergeLocal);
      return existing ? 'Profil načten ze Supabase' : 'Nový profil vytvořen v Supabase';
    } else {
      saveCurrentUser({
        userKey,
        username: cleanUser,
        displayName,
        pinHash
      });
      setSyncState('local');
      renderAll();
      return 'Uživatel přihlášen (lokální režim)';
    }
  }

  async function syncWithSupabase(pushLocalDays = true) {
    if (!isCloudReady()) {
      setSyncState('local');
      return;
    }
    setSyncState('syncing');
    try {
      // 1. Načteme profil ze Supabase
      const profRows = await sbFetch(
        `/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.userKey)}&select=*`
      );
      if (profRows && profRows[0]) {
        applySettingsFromProfileRow(profRows[0]);
        if (profRows[0].display_name) {
          currentUser.displayName = profRows[0].display_name;
          saveCurrentUser(currentUser);
        }
        await saveSettings(true);
        applyTheme();
      } else {
        await pushProfileToSupabase();
      }

      // 2. Načteme dny uživatele ze Supabase
      const remoteRows = await sbFetch(
        `/rest/v1/attendance_days?user_key=eq.${encodeURIComponent(currentUser.userKey)}&select=*&order=date.asc`
      );
      const remoteMap = new Map((remoteRows || []).map(r => [r.date, localDayFromSupabaseRow(r)]));

      // 3. Zjistíme, které lokální dny nahrát do cloudu
      const toUpload = [];
      if (pushLocalDays) {
        for (const [dateKey, localDay] of records.entries()) {
          const rem = remoteMap.get(dateKey);
          if (!rem) {
            toUpload.push(dayRowForSupabase(localDay));
            remoteMap.set(dateKey, localDay);
          } else {
            const locTime = Date.parse(localDay.updatedAt || '') || 0;
            const remTime = Date.parse(rem.updatedAt || '') || 0;
            if (locTime > remTime) {
              toUpload.push(dayRowForSupabase(localDay));
              remoteMap.set(dateKey, localDay);
            }
          }
        }
      }

      if (toUpload.length > 0) {
        await sbFetch('/rest/v1/attendance_days?on_conflict=user_key,date', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(toUpload)
        });
      }

      // 4. Uložíme sloučená data do lokální IndexedDB
      const tx = db.transaction(['days'], 'readwrite');
      const store = tx.objectStore('days');
      store.clear();
      for (const day of remoteMap.values()) {
        store.put(day);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });

      records = remoteMap;
      setSyncState('online');
      renderAll();
    } catch (err) {
      console.error('Chyba synchronizace se Supabase:', err);
      setSyncState('error');
      throw err;
    }
  }

  // ============================================================================
  // STATISTIKY A VÝPOČTY MĚSÍCE / ROKU
  // ============================================================================
  function yearVacationUsed(year) {
    let usedDays = 0;
    for (const [key, day] of records.entries()) {
      if (!key.startsWith(`${year}-`)) continue;
      if (day.type === 'vacation') usedDays += 1;
      else if (day.type === 'halfVacation') usedDays += 0.5;
    }
    return usedDays;
  }

  function monthStats(monthDate) {
    const year = monthDate.getFullYear(), month = monthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayKey();
    let fund = 0, worked = 0, credited = 0, balance = 0, recorded = 0, missing = 0;
    let scheduledWorkdays = 0, weekendWorked = 0, totalBreaks = 0;
    const breakdown = {
      work: 0,
      homeOffice: 0,
      businessTrip: 0,
      vacation: 0,
      halfVacation: 0,
      doctor: 0,
      sick: 0,
      compTime: 0,
      other: 0
    };

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d, 12);
      const key = localDateKey(dateObj);
      const baseTarget = baseTargetForDate(key);
      if (baseTarget > 0) scheduledWorkdays++;
      const rec = records.get(key);
      fund += rec ? targetForDay(rec) : baseTarget;

      if (rec) {
        const m = dayMetrics(rec);
        worked += m.worked;
        credited += m.credited;
        balance += m.balance;
        totalBreaks += m.breakMinutes;
        recorded++;
        if (isWeekendDate(dateObj)) weekendWorked += m.worked;
        if ( ['work', 'homeOffice', 'businessTrip'].includes(rec.type) ) {
          breakdown[rec.type] += m.worked;
        } else if (breakdown[rec.type] !== undefined) {
          breakdown[rec.type] += m.credited;
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
      totalBreaks,
      breakdown
    };
  }

  // ============================================================================
  // VYKRESLOVÁNÍ UI
  // ============================================================================
  function applyTheme() {
    if (settings.theme === 'light' || settings.theme === 'dark') {
      document.documentElement.dataset.theme = settings.theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }

  function setBalanceClass(el, value) {
    if (!el) return;
    el.classList.remove('positive', 'negative');
    if (value > 0) el.classList.add('positive');
    if (value < 0) el.classList.add('negative');
  }

  function formatScheduleDaysSummary() {
    const days = activeWorkDays();
    const mapNames = { 1: 'Po', 2: 'Út', 3: 'St', 4: 'Čt', 5: 'Pá', 6: 'So', 0: 'Ne' };
    const ordered = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d));
    if (ordered.join(',') === '1,2,3,4,5') return 'Po–Pá';
    if (ordered.join(',') === '1,2,3,4,5,6') return 'Po–So (vč. sobot)';
    if (ordered.join(',') === '1,2,3,4,5,6,0') return 'Po–Ne (vč. víkendů)';
    return ordered.map(d => mapNames[d]).join(', ') || 'Bez pevného rozvrhu';
  }

  function renderAuthAndSyncUI() {
    const name = currentUser ? (currentUser.displayName || currentUser.username) : 'Nepřihlášen';
    const initial = (name[0] || 'P').toUpperCase();

    $('#sidebarAvatar').textContent = initial;
    $('#headerUserAvatar').textContent = initial;
    $('#settingsAvatar').textContent = initial;

    $('#sidebarUserName').textContent = name;
    $('#headerUserName').textContent = currentUser ? name : 'Přihlásit';
    $('#settingsProfileName').textContent = currentUser ? `${name} (@${currentUser.username})` : 'Nepřihlášený uživatel';

    const dot = $('#syncDot');
    const headerText = $('#syncHeaderText');
    const sideSync = $('#sidebarSyncStatus');
    const sbBadge = $('#supabaseStatusBadge');
    const userBadge = $('#settingsUserBadge');

    dot.className = 'sync-dot';
    sideSync.className = 'sync-pill';

    if (isCloudReady()) {
      if (syncState === 'syncing') {
        dot.classList.add('syncing');
        headerText.textContent = 'Synchronizuji…';
        sideSync.textContent = 'Synchronizuji…';
      } else if (syncState === 'error') {
        dot.classList.add('error');
        headerText.textContent = 'Offline / Chyba';
        sideSync.textContent = 'Chyba spojení (uloženo lokálně)';
      } else {
        dot.classList.add('online');
        sideSync.classList.add('online');
        headerText.textContent = 'Supabase Online';
        sideSync.textContent = 'Supabase synchronizováno';
      }
      sbBadge.textContent = 'Připojeno';
      sbBadge.classList.remove('subtle-badge');
      userBadge.textContent = 'Cloud účet';
      $('#settingsProfileSub').textContent = `Synchronizováno se Supabase databází (${supabaseConfig.url.replace(/^https?:\/\//, '')})`;
    } else if (isSupabaseConfigured()) {
      dot.classList.add('online');
      sideSync.classList.add('online');
      headerText.textContent = 'Supabase Připojeno';
      sideSync.textContent = 'DB připojena – přihlas se';
      sbBadge.textContent = 'Připojeno';
      sbBadge.classList.remove('subtle-badge');
      userBadge.textContent = 'Nepřihlášen';
      $('#settingsProfileSub').textContent = 'Supabase databáze je připojená – přihlas se svým jménem a PINem.';
    } else {
      dot.classList.add('local');
      headerText.textContent = 'Lokální';
      sideSync.textContent = currentUser ? 'Lokální profil' : 'Lokální režim';
      sbBadge.textContent = 'Nepřipojeno';
      sbBadge.classList.add('subtle-badge');
      userBadge.textContent = currentUser ? 'Lokální profil' : 'Bez účtu';
      $('#settingsProfileSub').textContent = 'Data jsou uložena lokálně v tomto prohlížeči / telefonu.';
    }

    const builtIn = isBuiltInSupabase();
    $('#supabaseAutoConnectedBox')?.classList.toggle('hidden', !builtIn);
    $('#supabaseManualForm')?.classList.toggle('hidden', builtIn);
    $('#saveSupabaseBtn')?.classList.toggle('hidden', builtIn);
    $('#supabaseManualActions')?.classList.toggle('hidden', builtIn);

    $('#logoutBtn').classList.toggle('hidden', !currentUser);

    // Sidebar rozvrh
    $('#sidebarScheduleHours').textContent = `${settings.workStart} – ${settings.workEnd}`;
    $('#sidebarScheduleDays').textContent = `${formatScheduleDaysSummary()} · Fond ${formatDuration(settings.dailyTargetMinutes)}`;
  }

  function updateGreeting() {
    const el = $('#headerGreeting');
    if (!el) return;
    const h = new Date().getHours();
    let greet = 'Dobré odpoledne';
    if (h >= 5 && h < 9) greet = 'Dobré ráno';
    else if (h >= 9 && h < 12) greet = 'Dobré dopoledne';
    else if (h >= 12 && h < 18) greet = 'Dobré odpoledne';
    else greet = 'Dobrý večer';

    const name = currentUser ? (currentUser.displayName || currentUser.username) : '';
    el.textContent = name ? `${greet}, ${name}` : greet;
  }

  function updateActiveShiftWidget() {
    const banner = $('#activeShiftBanner');
    const timer = $('#activeShiftTimer');
    const hint = $('#activeShiftStartHint');
    if (!banner || !timer) return;

    const key = todayKey();
    const rec = records.get(key);
    if (rec && allowsWork(rec.type) && rec.start && !rec.end) {
      banner.classList.remove('hidden');
      if (hint) hint.textContent = `Směna (${TYPE_LABELS[rec.type] || 'Práce'}) probíhá od ${rec.start}`;
      const sMin = timeToMinutes(rec.start);
      if (sMin !== null) {
        const now = new Date();
        const curMin = now.getHours() * 60 + now.getMinutes();
        const curSec = now.getSeconds();
        const diffSec = (curMin >= sMin ? (curMin - sMin) * 60 : (1440 - sMin + curMin) * 60) + curSec;
        const hh = Math.floor(diffSec / 3600);
        const mm = Math.floor((diffSec % 3600) / 60);
        const ss = diffSec % 60;
        timer.textContent = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
      }
    } else {
      banner.classList.add('hidden');
    }
  }

  function renderToday() {
    const now = new Date();
    const key = localDateKey(now);
    const rec = records.get(key);
    const hours = defaultHoursForDate(key);

    $('#todayDate').textContent = fmtDay(now);
    const badge = $('#todayTypeBadge');
    const timeBadge = $('#todayTimeBadge');
    const holiday = holidayName(key);

    badge.textContent = rec
      ? TYPE_LABELS[rec.type]
      : (holiday || (isScheduledWorkday(now) ? 'Pracovní den' : (isWeekendDate(now) ? 'Víkend' : 'Volno')));

    if (rec && (rec.start || rec.end)) {
      timeBadge.textContent = `${rec.start || '?'} – ${rec.end || 'dosud'}`;
    } else if (rec) {
      timeBadge.textContent = TYPE_LABELS[rec.type];
    } else {
      timeBadge.textContent = `Rozvrh ${hours.start}–${hours.end}`;
    }

    const target = rec ? targetForDay(rec) : baseTargetForDate(key);
    const metrics = rec ? dayMetrics(rec) : { worked: 0, credited: 0, balance: 0, target, breakMinutes: 0 };

    $('#todayWorked').textContent = formatDuration(metrics.worked);
    $('#todayCredited').textContent = formatDuration(metrics.credited);
    $('#todayBreak').textContent = `${metrics.breakMinutes} min`;
    $('#todayTarget').textContent = formatDuration(target);
    $('#todayBalance').textContent = rec ? formatDuration(metrics.balance, true) : '0:00';
    setBalanceClass($('#todayBalance'), rec ? metrics.balance : 0);

    $('#todayBalanceHint').textContent = rec
      ? `${TYPE_LABELS[rec.type]}${rec.note ? ` · ${rec.note}` : ''}`
      : (holiday || (isScheduledWorkday(now) ? 'Dnešek zatím není zapsaný' : 'Volný den mimo běžný fond'));

    // Progress bar dnešního fondu
    const pct = target > 0 ? clamp(Math.round(((metrics.worked + metrics.credited) / target) * 100), 0, 100) : (metrics.worked > 0 ? 100 : 0);
    $('#todayProgressPercent').textContent = `${pct} %`;
    $('#todayProgressBar').style.width = `${pct}%`;

    // Podtitulky u rychlých tlačítek
    $('#normalHoursSub').textContent = `${hours.start} – ${hours.end} (fond ${formatDuration(hours.target)})`;

    // Týdenní pás (Po–Ne aktuálního týdne)
    renderWeekStrip(now);
    updateGreeting();
    updateActiveShiftWidget();

    // Měsíční souhrn na kartě Dnes
    const stat = monthStats(startOfMonth(now));
    $('#monthSnapshotLabel').textContent = fmtMonth(now);
    $('#snapWorked').textContent = formatDuration(stat.worked);
    $('#snapFundSub').textContent = `z fondu ${formatDuration(stat.fund)}`;
    $('#snapCredited').textContent = formatDuration(stat.credited);
    $('#snapBalance').textContent = formatDuration(stat.balance, true);
    setBalanceClass($('#snapBalance'), stat.balance);
    $('#snapMissing').textContent = String(stat.missing);
  }

  function renderWeekStrip(refDate) {
    const grid = $('#weekStripGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const mondayOffset = (refDate.getDay() + 6) % 7;
    const monday = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() - mondayOffset, 12);
    const today = todayKey();

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = localDateKey(d);
      const rec = records.get(key);
      const m = rec ? dayMetrics(rec) : null;
      const status = statusClassForDay(key, rec);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'week-day-btn';
      if (key === today) btn.classList.add('today');
      if (!isScheduledWorkday(d) && !rec) btn.classList.add('weekend-off');

      const hoursText = rec
        ? (m.worked > 0 ? formatDuration(m.worked) : SHORT_TYPE_LABELS[rec.type] || '—')
        : (isScheduledWorkday(d) ? '—' : 'Volno');

      btn.innerHTML = `
        <span class="week-day-name">${fmtWeekdayShort(d)}</span>
        <span class="week-day-num">${d.getDate()}</span>
        <i class="day-status ${status}"></i>
        <span class="week-day-hours">${hoursText}</span>
      `;
      btn.addEventListener('click', () => openDayEditor(key));
      grid.appendChild(btn);
    }
  }

  function statusClassForDay(key, rec) {
    const date = parseDateKey(key);
    if (rec) {
      if (rec.type === 'doctor' || rec.type === 'sick') return 'doctor';
      if (rec.type === 'homeOffice' || rec.type === 'businessTrip') return 'home';
      if (['vacation', 'halfVacation', 'holiday', 'compTime', 'other'].includes(rec.type)) return 'leave';
      if (isWeekendDate(date)) return 'weekend-work';
      return 'work';
    }
    if (isPublicHoliday(key)) return 'leave';
    if (baseTargetForDate(key) > 0 && key < todayKey()) return 'missing';
    return '';
  }

  function renderCalendar() {
    $('#calendarTitle').textContent = fmtMonth(calendarMonth);
    $('#calendarScheduleHint').textContent = `Rozvrh: ${formatScheduleDaysSummary()} · ${settings.workStart}–${settings.workEnd}`;

    const grid = $('#calendarGrid');
    grid.innerHTML = '';
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1, 12);
    const mondayIndex = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayIndex);
    const today = todayKey();

    for (let i = 0; i < 42; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = localDateKey(date);
      const rec = records.get(key);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-cell';
      if (!isSameMonth(date, calendarMonth)) btn.classList.add('outside');
      if (isWeekendDate(date)) {
        btn.classList.add('weekend');
        if (isScheduledWorkday(date)) btn.classList.add('scheduled-weekend');
      }
      if (key === today) btn.classList.add('today');

      const status = statusClassForDay(key, rec);
      const m = rec ? dayMetrics(rec) : null;
      const h = holidayName(key);

      let metaLabel = '';
      let subTime = '';
      if (rec) {
        if (m.worked > 0) {
          metaLabel = formatDuration(m.worked);
          subTime = rec.start && rec.end ? `${rec.start}–${rec.end}` : SHORT_TYPE_LABELS[rec.type];
        } else {
          metaLabel = SHORT_TYPE_LABELS[rec.type] || TYPE_LABELS[rec.type];
          subTime = m.credited > 0 ? formatDuration(m.credited) : '';
        }
      } else if (h) {
        metaLabel = 'Svátek';
      } else if (isScheduledWorkday(date) && isSameMonth(date, calendarMonth)) {
        metaLabel = key < today ? 'Chybí' : '';
      }

      btn.innerHTML = `
        <div class="day-top-row">
          <span class="day-number">${date.getDate()}</span>
          <i class="day-status ${status}"></i>
        </div>
        <span class="day-meta">${metaLabel}</span>
        <span class="day-sub-time">${subTime}</span>
      `;
      btn.title = rec ? `${TYPE_LABELS[rec.type]}${rec.note ? ` – ${rec.note}` : ''}` : (h || '');
      btn.addEventListener('click', () => openDayEditor(key));
      grid.appendChild(btn);
    }

    // Pravý postranní panel v Kalendáři
    const st = monthStats(calendarMonth);
    $('#calStatWorked').textContent = formatDuration(st.worked);
    $('#calStatFund').textContent = formatDuration(st.fund);
    $('#calStatBalance').textContent = formatDuration(st.balance, true);
    setBalanceClass($('#calStatBalance'), st.balance);
    $('#calendarSideSummary').textContent = st.missing > 0
      ? `V tomto měsíci chybí vyplnit ${st.missing} pracovních dnů.`
      : `Evidováno ${st.recorded} dnů v měsíci.`;

    const listEl = $('#calendarMonthList');
    listEl.innerHTML = '';
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const prefix = `${year}-${pad(month + 1)}-`;
    const monthRecords = [...records.values()]
      .filter(r => r.date.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date));

    if (monthRecords.length === 0) {
      listEl.innerHTML = `<p class="muted" style="margin: 4px 0; font-size: 12.5px;">V tomto měsíci zatím nejsou žádné uložené dny.</p>`;
    } else {
      for (const rec of monthRecords) {
        const d = parseDateKey(rec.date);
        const m = dayMetrics(rec);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'day-list-item';
        const timeStr = rec.start && rec.end ? `${rec.start}–${rec.end}` : TYPE_LABELS[rec.type];
        item.innerHTML = `
          <div class="day-list-left">
            <strong>${d.getDate()}. ${d.getMonth() + 1}. (${fmtWeekdayShort(d)}) · ${TYPE_LABELS[rec.type]}</strong>
            <small>${timeStr}${rec.note ? ` · ${rec.note}` : ''}</small>
          </div>
          <div class="day-list-right">
            <strong>${formatDuration(m.worked || m.credited)}</strong>
            <small class="${m.balance > 0 ? 'positive' : m.balance < 0 ? 'negative' : ''}">${formatDuration(m.balance, true)}</small>
          </div>
        `;
        item.addEventListener('click', () => openDayEditor(rec.date));
        listEl.appendChild(item);
      }
    }
  }

  function renderOverview() {
    $('#overviewTitle').textContent = fmtMonth(overviewMonth);
    const userLabel = currentUser ? (currentUser.displayName || currentUser.username) : 'Lokální uživatel';
    $('#overviewUserSubtitle').textContent = `${userLabel} · Rozvrh ${formatScheduleDaysSummary()} (${settings.workStart}–${settings.workEnd})`;

    const s = monthStats(overviewMonth);
    $('#overviewBalance').textContent = formatDuration(s.balance, true);
    setBalanceClass($('#overviewBalance'), s.balance);
    $('#overviewFund').textContent = formatDuration(s.fund);
    $('#overviewWorkdaysCount').textContent = `${s.scheduledWorkdays} plánovaných pracovních dnů`;
    $('#overviewWorked').textContent = formatDuration(s.worked);
    $('#overviewWeekendWorked').textContent = s.weekendWorked > 0
      ? `z toho víkendy ${formatDuration(s.weekendWorked)}`
      : 'žádné víkendové směny';
    $('#overviewCredited').textContent = formatDuration(s.credited);
    $('#overviewRecorded').textContent = String(s.recorded);
    $('#overviewBreaks').textContent = formatDuration(s.totalBreaks);

    const pct = s.fund > 0 ? clamp(Math.round(((s.worked + s.credited) / s.fund) * 100), 0, 100) : 100;
    $('#overviewProgressPct').textContent = `${pct} %`;
    $('#overviewProgressBar').style.width = `${pct}%`;

    // Dovolená za vybraný rok
    const year = overviewMonth.getFullYear();
    const usedVac = yearVacationUsed(year);
    const allowVac = Number(settings.vacationAllowanceDays) || 20;
    const remVac = Math.max(0, allowVac - usedVac);
    $('#overviewVacationRemaining').textContent = `${remVac.toLocaleString('cs-CZ')} dnů`;
    $('#overviewVacationUsed').textContent = `vyčerpáno ${usedVac.toLocaleString('cs-CZ')} z ${allowVac.toLocaleString('cs-CZ')} dnů (${year})`;

    $('#overviewMissingText').textContent = s.missing
      ? `Chybí vyplnit ${s.missing} minul${s.missing === 1 ? 'ý pracovní den' : s.missing < 5 ? 'é pracovní dny' : 'ých pracovních dnů'}.`
      : 'Všechny minulé pracovní dny jsou řádně evidované.';

    const labels = [
      ['work', 'Běžná práce (směny)'],
      ['homeOffice', 'Home office'],
      ['businessTrip', 'Služební cesty'],
      ['vacation', 'Dovolená'],
      ['halfVacation', '½ dovolené'],
      ['doctor', 'Lékař / Propustka'],
      ['sick', 'Nemoc / Neschopenka'],
      ['compTime', 'Náhradní volno'],
      ['other', 'Jiné omluvené volno']
    ];
    $('#absenceBreakdown').innerHTML = labels
      .map(([k, label]) => `<div class="breakdown-row"><span>${label}</span><strong>${formatDuration(s.breakdown[k] || 0)}</strong></div>`)
      .join('');

    // Kompletní tabulka měsíčního výkazu
    renderMonthlyTable(overviewMonth, userLabel);
  }

  function renderMonthlyTable(monthDate, userLabel) {
    const tbody = $('#overviewTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    $('#printReportMeta').textContent = `Zaměstnanec / Uživatel: ${userLabel} · Období: ${fmtMonth(monthDate)}`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d, 12);
      const key = localDateKey(dateObj);
      const rec = records.get(key);
      const holiday = holidayName(key);
      const m = rec ? dayMetrics(rec) : null;

      const tr = document.createElement('tr');
      if (isWeekendDate(dateObj)) tr.classList.add('row-weekend');

      const typeText = rec ? TYPE_LABELS[rec.type] : (holiday ? `Svátek (${holiday})` : (isWeekendDate(dateObj) ? 'Víkend' : '—'));
      const timeRange = rec && (rec.start || rec.end) ? `${rec.start || '?'}–${rec.end || '?'}` : '—';
      const breakText = rec && m.breakMinutes > 0 ? `${m.breakMinutes}m` : '—';
      const workedText = rec ? formatDuration(m.worked + m.credited) : '—';
      const balText = rec ? formatDuration(m.balance, true) : '—';
      const balClass = rec ? (m.balance > 0 ? 'positive' : m.balance < 0 ? 'negative' : '') : '';

      tr.innerHTML = `
        <td><strong>${d}.${month + 1}.</strong></td>
        <td>${fmtWeekdayShort(dateObj)}</td>
        <td>${typeText}</td>
        <td>${timeRange}</td>
        <td>${breakText}</td>
        <td><strong>${workedText}</strong></td>
        <td class="${balClass}"><strong>${balText}</strong></td>
        <td class="note-cell">${rec?.note || ''}</td>
      `;
      tr.addEventListener('click', () => openDayEditor(key));
      tbody.appendChild(tr);
    }
  }

  function renderSettings() {
    $('#settingStart').value = settings.workStart;
    $('#settingEnd').value = settings.workEnd;
    $('#settingTarget').value = minutesToTime(settings.dailyTargetMinutes);
    $('#settingBreak').value = settings.breakMinutes;
    $('#settingBreakAfter').value = settings.breakAfterMinutes;
    $('#settingVacationAllowance').value = settings.vacationAllowanceDays ?? 20;
    $('#settingAutoFill').checked = !!settings.autoFill;
    $('#settingTheme').value = settings.theme;

    // Víkendy a dny v týdnu
    $('#settingWeekendMode').value = settings.weekendMode || 'none';
    const days = activeWorkDays();
    $$('#settingWeekdaysGroup input[type="checkbox"]').forEach(cb => {
      cb.checked = days.includes(Number(cb.value));
    });

    $('#settingWeekendCustomHours').checked = !!settings.weekendCustomHours;
    $('#weekendCustomFields').classList.toggle('hidden', !settings.weekendCustomHours);
    $('#settingWeekendStart').value = settings.weekendStart || '07:00';
    $('#settingWeekendEnd').value = settings.weekendEnd || '15:30';
    $('#settingWeekendTarget').value = minutesToTime(settings.weekendTargetMinutes ?? 480);
    $('#settingWorkOnHolidays').checked = !!settings.workOnHolidays;

    // Supabase pole
    $('#supabaseUrlInput').value = supabaseConfig.url || '';
    $('#supabaseKeyInput').value = supabaseConfig.anonKey || '';

    renderAuthAndSyncUI();
  }

  function renderAll() {
    renderAuthAndSyncUI();
    renderToday();
    renderCalendar();
    renderOverview();
    renderSettings();
  }

  // ============================================================================
  // PŘEPÍNÁNÍ POHLEDŮ A EDITOR DNE
  // ============================================================================
  function switchView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $$('.nav-button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $(`#view${name[0].toUpperCase()}${name.slice(1)}`).classList.add('active');
    const titles = {
      today: 'Dnešní přehled',
      calendar: 'Kalendář směn',
      overview: 'Přehled a výkaz',
      settings: 'Nastavení a databáze'
    };
    $('#headerTitle').textContent = titles[name] || 'Docházka';
    if (name === 'calendar') renderCalendar();
    if (name === 'overview') renderOverview();
    if (name === 'settings') renderSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function formDayFromInputs() {
    return {
      date: $('#dayDate').value,
      type: $('#dayType').value,
      start: $('#dayStart').value,
      end: $('#dayEnd').value,
      manualBreak: $('#manualBreakToggle').checked,
      breakMinutes: Number($('#dayBreak').value) || 0,
      doctorFullDay: $('#doctorFullDay').checked,
      doctorStart: $('#doctorStart').value,
      doctorEnd: $('#doctorEnd').value,
      otherMinutes: Number($('#otherMinutes').value) || 0,
      note: $('#dayNote').value.trim(),
      updatedAt: new Date().toISOString()
    };
  }

  function fillDayForm(day) {
    $('#dayDate').value = day.date;
    $('#dayType').value = day.type;
    $('#dayStart').value = day.start || '';
    $('#dayEnd').value = day.end || '';
    $('#manualBreakToggle').checked = !!day.manualBreak;
    $('#dayBreak').value = Number.isFinite(Number(day.breakMinutes)) ? Number(day.breakMinutes) : settings.breakMinutes;
    $('#doctorFullDay').checked = !!day.doctorFullDay;
    $('#doctorStart').value = day.doctorStart || '';
    $('#doctorEnd').value = day.doctorEnd || '';
    $('#otherMinutes').value = Number(day.otherMinutes) || 0;
    $('#dayNote').value = day.note || '';
    updateDayFormVisibility();
    updateDayPreview();
  }

  function updateDayFormVisibility() {
    const type = $('#dayType').value;
    const key = $('#dayDate').value || todayKey();
    const hours = defaultHoursForDate(key);
    const workAllowed = allowsWork(type) && !(type === 'doctor' && $('#doctorFullDay').checked);

    $('#workFields').classList.toggle('hidden', !workAllowed);
    $('#doctorFields').classList.toggle('hidden', type !== 'doctor');
    $('#otherFields').classList.toggle('hidden', type !== 'other');
    $('#manualBreakWrap').classList.toggle('hidden', !$('#manualBreakToggle').checked || !workAllowed);
    $('#doctorTimeFields').classList.toggle('hidden', $('#doctorFullDay').checked || type !== 'doctor');

    if (workAllowed && settings.autoFill && !$('#dayStart').value && !$('#dayEnd').value) {
      $('#dayStart').value = hours.start;
      $('#dayEnd').value = hours.end;
    }
  }

  function updateDayPreview() {
    const day = formDayFromInputs();
    const m = dayMetrics(day);
    $('#autoBreakText').textContent = day.manualBreak ? `Vlastní ${m.breakMinutes} min` : `Automaticky ${m.breakMinutes} min`;
    $('#previewWorked').textContent = formatDuration(m.worked);
    $('#previewCredited').textContent = formatDuration(m.credited);
    $('#previewTarget').textContent = formatDuration(m.target);
    $('#previewBalance').textContent = formatDuration(m.balance, true);
    setBalanceClass($('#previewBalance'), m.balance);
  }

  function openDayEditor(key) {
    editingOriginal = records.get(key) || null;
    const day = editingOriginal ? structuredClone(editingOriginal) : defaultDay(key);
    const date = parseDateKey(key);
    const holiday = holidayName(key);
    $('#dayDialogEyebrow').textContent = isWeekendDate(date) ? 'Víkendový den' : 'Pracovní den';
    $('#dayDialogTitle').textContent = `${fmtDayShort(date)}${holiday ? ` · ${holiday}` : ''}`;
    $('#deleteDayBtn').classList.toggle('hidden', !editingOriginal);
    fillDayForm(day);
    $('#dayDialog').showModal();
  }

  function applyDefaultHoursToEditor() {
    const key = $('#dayDate').value || todayKey();
    const hours = defaultHoursForDate(key);
    $('#dayStart').value = hours.start;
    $('#dayEnd').value = hours.end;
    $('#manualBreakToggle').checked = false;
    $('#dayBreak').value = settings.breakMinutes;
    updateDayFormVisibility();
    updateDayPreview();
  }

  async function quickToday(mutator, message = 'Dnešek uložen') {
    const key = todayKey();
    const day = records.get(key) ? structuredClone(records.get(key)) : defaultDay(key);
    mutator(day, defaultHoursForDate(key));
    await saveDay(day);
    toast(message);
  }

  async function fillMissingDaysInMonth(monthDate) {
    const year = monthDate.getFullYear(), month = monthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayKey();
    const missingKeys = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const key = localDateKey(new Date(year, month, d, 12));
      if (key <= today && !records.has(key) && baseTargetForDate(key) > 0) {
        missingKeys.push(key);
      }
    }

    if (missingKeys.length === 0) {
      toast('Žádné nevyplněné pracovní dny k doplnění');
      return;
    }

    if (!confirm(`Doplnit běžnou pracovní dobu do ${missingKeys.length} nevyplněných pracovních dnů v měsíci ${fmtMonth(monthDate)}?`)) {
      return;
    }

    for (const key of missingKeys) {
      const hours = defaultHoursForDate(key);
      const day = {
        date: key,
        type: 'work',
        start: hours.start,
        end: hours.end,
        manualBreak: false,
        breakMinutes: settings.breakMinutes,
        doctorFullDay: false,
        doctorStart: '',
        doctorEnd: '',
        otherMinutes: 0,
        note: '',
        updatedAt: new Date().toISOString()
      };
      await idb('days', 'readwrite', s => s.put(day));
      records.set(key, day);
    }

    renderAll();
    if (isCloudReady()) {
      syncWithSupabase(true).catch(console.warn);
    }
    toast(`Doplněno ${missingKeys.length} pracovních dnů`);
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ============================================================================
  // EXPORT CSV, JSON ZÁLOHA A IMPORT
  // ============================================================================
  function exportMonthlyCsv(monthDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows = [
      ['Datum', 'Den', 'Typ dne', 'Příchod', 'Odchod', 'Přestávka (min)', 'Odpracováno', 'Omluveno', 'Fond', 'Saldo', 'Poznámka']
    ];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d, 12);
      const key = localDateKey(dateObj);
      const rec = records.get(key);
      const m = rec ? dayMetrics(rec) : { worked: 0, credited: 0, target: baseTargetForDate(key), balance: 0, breakMinutes: 0 };
      rows.push([
        key,
        fmtWeekdayShort(dateObj),
        rec ? TYPE_LABELS[rec.type] : (holidayName(key) || (isWeekendDate(dateObj) ? 'Víkend' : '')),
        rec?.start || '',
        rec?.end || '',
        rec ? String(m.breakMinutes) : '0',
        formatDuration(m.worked),
        formatDuration(m.credited),
        formatDuration(m.target),
        formatDuration(m.balance, true),
        (rec?.note || '').replace(/"/g, '""')
      ]);
    }

    const csvContent = '\uFEFF' + rows.map(r => r.map(c => `"${c}"`).join(';')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vykaz-dochazky-${year}-${pad(month + 1)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV výkaz stažen');
  }

  async function exportBackup() {
    const days = [...records.values()].sort((a, b) => a.date.localeCompare(b.date));
    const payload = {
      app: 'osobni-dochazka',
      version: 2,
      exportedAt: new Date().toISOString(),
      user: currentUser ? { username: currentUser.username, displayName: currentUser.displayName } : null,
      settings,
      days
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const fileName = `dochazka-zaloha-${todayKey()}.json`;
    const file = new File([blob], fileName, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Záloha docházky' });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('JSON záloha exportována');
  }

  async function importBackup(file) {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (payload.app !== 'osobni-dochazka' || !Array.isArray(payload.days)) {
      throw new Error('Soubor není platná záloha docházky.');
    }
    const tx = db.transaction(['days', 'settings'], 'readwrite');
    const dayStore = tx.objectStore('days');
    dayStore.clear();
    for (const day of payload.days) dayStore.put(day);
    if (payload.settings) {
      tx.objectStore('settings').put(normalizeSettings(payload.settings));
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    await loadData();
    renderAll();
    if (isCloudReady()) {
      await syncWithSupabase(true);
    }
  }

  async function resetAll() {
    if (!confirm('Opravdu vymazat veškerou lokální docházku i nastavení v tomto zařízení?')) return;
    const tx = db.transaction(['days', 'settings'], 'readwrite');
    tx.objectStore('days').clear();
    tx.objectStore('settings').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    settings = structuredClone(DEFAULT_SETTINGS);
    records.clear();
    await saveSettings(true);
    applyTheme();
    renderAll();
    toast('Lokální data vymazána');
  }

  // ============================================================================
  // UDÁLOSTI A OVLÁDÁNÍ PRVKŮ
  // ============================================================================
  function syncWeekdaysFromMode(mode) {
    let days = [1, 2, 3, 4, 5];
    if (mode === 'saturday') days = [1, 2, 3, 4, 5, 6];
    else if (mode === 'sunday') days = [1, 2, 3, 4, 5, 0];
    else if (mode === 'both') days = [1, 2, 3, 4, 5, 6, 0];
    else if (mode === 'custom') return;
    $$('#settingWeekdaysGroup input[type="checkbox"]').forEach(cb => {
      cb.checked = days.includes(Number(cb.value));
    });
  }

  function detectModeFromWeekdays(days) {
    const sorted = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).join(',');
    if (sorted === '1,2,3,4,5') return 'none';
    if (sorted === '1,2,3,4,5,6') return 'saturday';
    if (sorted === '1,2,3,4,5,0') return 'sunday';
    if (sorted === '1,2,3,4,5,6,0') return 'both';
    return 'custom';
  }

  function openAuthModal() {
    if (currentUser) {
      $('#authUsername').value = currentUser.username || '';
      $('#authDisplayName').value = currentUser.displayName || '';
    }
    $('#authPin').value = '';
    $('#authDialog').showModal();
  }

  function bindEvents() {
    // Navigace (mobil i desktop sidebar)
    $$('.nav-button').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    $('#goToOverviewBtn')?.addEventListener('click', () => switchView('overview'));

    // Tlačítka v hlavičce a sidebaru
    $('#editTodayBtn').addEventListener('click', () => openDayEditor(todayKey()));
    $('#installHelpBtn').addEventListener('click', () => $('#helpDialog').showModal());
    $('#sidebarInstallBtn').addEventListener('click', () => $('#helpDialog').showModal());
    $('#closeHelpBtn').addEventListener('click', () => $('#helpDialog').close());

    $('#sidebarUserBtn').addEventListener('click', openAuthModal);
    $('#headerUserBtn').addEventListener('click', openAuthModal);
    $('#openAuthDialogBtn').addEventListener('click', openAuthModal);
    $('#closeAuthBtn').addEventListener('click', () => $('#authDialog').close());

    $('#syncBadgeBtn').addEventListener('click', async () => {
      if (!isSupabaseConfigured()) {
        switchView('settings');
        toast('Nejprve nastav Supabase URL a Anon Key');
        return;
      }
      if (!currentUser) {
        openAuthModal();
        return;
      }
      try {
        await syncWithSupabase(true);
        toast('Synchronizováno se Supabase');
      } catch (err) {
        alert(`Synchronizace selhala: ${err.message}`);
      }
    });

    $('#sidebarSyncNowBtn').addEventListener('click', () => $('#syncBadgeBtn').click());

    // Rychlé akce na kartě Dnes
    $('#arrivalNowBtn').addEventListener('click', () => quickToday((day) => {
      if (!allowsWork(day.type)) day.type = 'work';
      day.start = formatClock();
      day.end = '';
      day.manualBreak = false;
    }, 'Příchod zapsán'));

    $('#departureNowBtn').addEventListener('click', () => quickToday((day, hours) => {
      if (!allowsWork(day.type)) day.type = 'work';
      if (!day.start) day.start = hours.start;
      day.end = formatClock();
      day.manualBreak = false;
    }, 'Odchod zapsán'));

    $('#normalHoursBtn').addEventListener('click', () => quickToday((day, hours) => {
      day.type = 'work';
      day.start = hours.start;
      day.end = hours.end;
      day.manualBreak = false;
      day.breakMinutes = settings.breakMinutes;
    }, 'Běžná pracovní doba uložena'));

    $('#quickVacationBtn').addEventListener('click', () => quickToday((day) => {
      day.type = 'vacation';
      day.start = '';
      day.end = '';
    }, 'Zapsána celodenní dovolená'));

    $('#endShiftNowBtn')?.addEventListener('click', () => $('#departureNowBtn').click());

    $('#quickHoBtn')?.addEventListener('click', () => quickToday((day, hours) => {
      day.type = 'homeOffice';
      day.start = hours.start;
      day.end = hours.end;
      day.manualBreak = false;
      day.breakMinutes = settings.breakMinutes;
    }, 'Zapsán Home office'));

    $('#quickDocBtn')?.addEventListener('click', () => quickToday((day) => {
      day.type = 'doctor';
      day.doctorFullDay = true;
      day.start = '';
      day.end = '';
    }, 'Zapsán lékař (celý den)'));

    $('#quickTripBtn')?.addEventListener('click', () => quickToday((day, hours) => {
      day.type = 'businessTrip';
      day.start = hours.start;
      day.end = hours.end;
      day.manualBreak = false;
      day.breakMinutes = settings.breakMinutes;
    }, 'Zapsána služební cesta'));

    // Kalendář & Přehled posuny měsíců
    $('#prevMonthBtn').addEventListener('click', () => { calendarMonth = addMonths(calendarMonth, -1); renderCalendar(); });
    $('#nextMonthBtn').addEventListener('click', () => { calendarMonth = addMonths(calendarMonth, 1); renderCalendar(); });
    $('#calendarTitle').addEventListener('click', () => { calendarMonth = startOfMonth(new Date()); renderCalendar(); });
    $('#fillMissingMonthBtn').addEventListener('click', () => fillMissingDaysInMonth(calendarMonth));
    $('#openTodayFromCalBtn').addEventListener('click', () => openDayEditor(todayKey()));

    $('#overviewPrevBtn').addEventListener('click', () => { overviewMonth = addMonths(overviewMonth, -1); renderOverview(); });
    $('#overviewNextBtn').addEventListener('click', () => { overviewMonth = addMonths(overviewMonth, 1); renderOverview(); });
    $('#fillMissingOverviewBtn').addEventListener('click', () => fillMissingDaysInMonth(overviewMonth));
    $('#exportCsvBtn').addEventListener('click', () => exportMonthlyCsv(overviewMonth));
    $('#printSheetBtn').addEventListener('click', () => window.print());

    // Nastavení: výpočet fondu z příchodu a odchodu
    $('#calcTargetFromHoursBtn').addEventListener('click', () => {
      const dur = durationMinutes($('#settingStart').value, $('#settingEnd').value);
      const brk = clamp(Number($('#settingBreak').value) || 0, 0, 240);
      const net = Math.max(0, dur - brk);
      $('#settingTarget').value = minutesToTime(net);
      toast(`Denní fond nastaven na ${formatDuration(net)}`);
    });

    // Nastavení: přepínání víkendového režimu a dnů v týdnu
    $('#settingWeekendMode').addEventListener('change', (e) => {
      syncWeekdaysFromMode(e.target.value);
    });

    $$('#settingWeekdaysGroup input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = $$('#settingWeekdaysGroup input[type="checkbox"]:checked').map(el => Number(el.value));
        $('#settingWeekendMode').value = detectModeFromWeekdays(checked);
      });
    });

    $('#settingWeekendCustomHours').addEventListener('change', (e) => {
      $('#weekendCustomFields').classList.toggle('hidden', !e.target.checked);
    });

    // Uložení nastavení pracovní doby a víkendů
    $('#settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const target = timeToMinutes($('#settingTarget').value);
      const weekendTarget = timeToMinutes($('#settingWeekendTarget').value);
      const checkedDays = $$('#settingWeekdaysGroup input[type="checkbox"]:checked').map(el => Number(el.value));

      settings = normalizeSettings({
        ...settings,
        id: 'settings',
        workStart: $('#settingStart').value,
        workEnd: $('#settingEnd').value,
        dailyTargetMinutes: target ?? 510,
        breakMinutes: clamp(Number($('#settingBreak').value) || 0, 0, 240),
        breakAfterMinutes: clamp(Number($('#settingBreakAfter').value) || 0, 0, 1440),
        vacationAllowanceDays: clamp(Number($('#settingVacationAllowance').value) || 20, 0, 60),
        autoFill: $('#settingAutoFill').checked,
        workDays: checkedDays.length > 0 ? checkedDays : [1, 2, 3, 4, 5],
        weekendMode: $('#settingWeekendMode').value,
        weekendCustomHours: $('#settingWeekendCustomHours').checked,
        weekendStart: $('#settingWeekendStart').value || '07:00',
        weekendEnd: $('#settingWeekendEnd').value || '15:30',
        weekendTargetMinutes: weekendTarget ?? 480,
        workOnHolidays: $('#settingWorkOnHolidays').checked,
        theme: $('#settingTheme').value
      });

      await saveSettings();
      applyTheme();
      renderAll();
      toast('Nastavení pracovní doby uloženo');
    });

    $('#settingTheme').addEventListener('change', async () => {
      settings.theme = $('#settingTheme').value;
      applyTheme();
      await saveSettings();
    });

    // Přihlášení uživatele (Jméno + PIN)
    $('#simpleAuthForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#authUsername').value;
      const displayName = $('#authDisplayName').value;
      const pin = $('#authPin').value;
      const mergeLocal = $('#authMergeLocal').checked;
      try {
        const msg = await loginWithSimpleProfile(username, displayName, pin, mergeLocal);
        $('#authDialog').close();
        renderAll();
        toast(msg);
      } catch (err) {
        alert(err.message || 'Přihlášení se nezdařilo.');
      }
    });

    $('#logoutBtn').addEventListener('click', () => {
      if (!confirm('Odhlásit aktuálního uživatele z tohoto zařízení?')) return;
      saveCurrentUser(null);
      setSyncState('local');
      renderAll();
      toast('Uživatel odhlášen');
    });

    // Supabase nastavení a připojení
    $('#saveSupabaseBtn').addEventListener('click', async () => {
      const url = $('#supabaseUrlInput').value;
      const key = $('#supabaseKeyInput').value;
      saveSupabaseConfigToStorage(url, key);
      try {
        await testSupabaseConnection();
        if (currentUser) {
          await syncWithSupabase(true);
          toast('Supabase připojena a synchronizována!');
        } else {
          renderAll();
          toast('Supabase připojena! Nyní se přihlas svým jménem.');
          openAuthModal();
        }
      } catch (err) {
        renderAll();
        alert(`Nepodařilo se spojit se Supabase:\n${err.message}\n\nUjisti se, že jsi v Supabase SQL Editoru spustil přiložený SQL skript.`);
      }
    });

    $('#syncNowBtn').addEventListener('click', async () => {
      if (!isSupabaseConfigured()) {
        alert('Nejprve vyplň a ulož Supabase Project URL a Anon Key.');
        return;
      }
      if (!currentUser) {
        openAuthModal();
        return;
      }
      try {
        await syncWithSupabase(true);
        toast('Data úspěšně synchronizována se Supabase');
      } catch (err) {
        alert(`Synchronizace selhala: ${err.message}`);
      }
    });

    $('#openSchemaDialogBtn').addEventListener('click', () => {
      $('#sqlCodeBlock').textContent = SQL_SCHEMA_TEXT;
      $('#schemaDialog').showModal();
    });
    $('#closeSchemaBtn').addEventListener('click', () => $('#schemaDialog').close());

    $('#copySqlBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(SQL_SCHEMA_TEXT);
        toast('SQL skript zkopírován do schránky');
      } catch {
        toast('Zkopíruj text ze zobrazeného okna');
      }
    });

    $('#shareConfigLinkBtn').addEventListener('click', async () => {
      if (!isSupabaseConfigured()) {
        alert('Nejprve ulož Supabase Project URL a Anon Key.');
        return;
      }
      const shareUrl = `${location.origin}${location.pathname}?sb_url=${encodeURIComponent(supabaseConfig.url)}&sb_key=${encodeURIComponent(supabaseConfig.anonKey)}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast('Odkaz s nastavením databáze zkopírován!');
      } catch {
        prompt('Zkopíruj si tento odkaz pro otevření na mobilu:', shareUrl);
      }
    });

    $('#disconnectSupabaseBtn').addEventListener('click', () => {
      if (!confirm('Odpojit Supabase databázi v tomto prohlížeči? Lokální záznamy zůstanou zachovány.')) return;
      saveSupabaseConfigToStorage('', '');
      setSyncState('local');
      renderAll();
      toast('Supabase databáze odpojena');
    });

    // Dialog úpravy dne
    $('#closeDayBtn').addEventListener('click', () => $('#dayDialog').close());
    $('#dayType').addEventListener('change', () => { updateDayFormVisibility(); updateDayPreview(); });
    $('#manualBreakToggle').addEventListener('change', () => { updateDayFormVisibility(); updateDayPreview(); });
    $('#doctorFullDay').addEventListener('change', () => { updateDayFormVisibility(); updateDayPreview(); });
    ['dayStart', 'dayEnd', 'dayBreak', 'doctorStart', 'doctorEnd', 'otherMinutes'].forEach(id => {
      $(`#${id}`).addEventListener('input', updateDayPreview);
    });
    $('#applyDefaultsBtn').addEventListener('click', applyDefaultHoursToEditor);

    $('#dayForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const day = formDayFromInputs();
      await saveDay(day);
      $('#dayDialog').close();
      toast('Den uložen');
    });

    $('#deleteDayBtn').addEventListener('click', async () => {
      const key = $('#dayDate').value;
      if (!confirm('Smazat tento den z evidence?')) return;
      await deleteDay(key);
      $('#dayDialog').close();
      toast('Den smazán');
    });

    // Export / Import / Reset
    $('#exportBtn').addEventListener('click', exportBackup);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importBackup(file);
        toast('Záloha úspěšně importována');
      } catch (err) {
        alert(err.message || 'Import se nepodařil.');
      }
      e.target.value = '';
    });
    $('#resetBtn').addEventListener('click', resetAll);

    // Zavření dialogů kliknutím mimo obsah (backdrop)
    ['dayDialog', 'authDialog', 'schemaDialog', 'helpDialog'].forEach(id => {
      const dlg = $(`#${id}`);
      dlg?.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
      });
    });
  }

  // ============================================================================
  // START APLIKACE
  // ============================================================================
  async function refreshConfigFromNetwork() {
    if (DEFAULT_SUPABASE_CONFIG.url && DEFAULT_SUPABASE_CONFIG.anonKey) return;
    try {
      const res = await fetch(`./config.js?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const text = await res.text();
      const urlMatch = text.match(/supabaseUrl\s*:\s*["']([^"']+)["']/);
      const keyMatch = text.match(/supabaseAnonKey\s*:\s*["']([^"']+)["']/);
      if (urlMatch?.[1] && keyMatch?.[1]) {
        DEFAULT_SUPABASE_CONFIG.url = urlMatch[1].trim().replace(/\/+$/, '');
        DEFAULT_SUPABASE_CONFIG.anonKey = keyMatch[1].trim();
        supabaseConfig = loadSupabaseConfig();
      }
    } catch {
      // Offline nebo lokální spuštění
    }
  }

  async function init() {
    try {
      await refreshConfigFromNetwork();
      db = await openDb();
      await loadData();
      bindEvents();
      renderAll();

      if (isCloudReady()) {
        syncWithSupabase(true).catch(console.warn);
      } else if (isSupabaseConfigured() && !currentUser) {
        openAuthModal();
      }

      if (!activeShiftInterval) {
        activeShiftInterval = setInterval(() => {
          updateActiveShiftWidget();
        }, 1000);
      }

      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('./sw.js').catch(console.warn);
      }
    } catch (err) {
      console.error(err);
      alert('Aplikaci se nepodařilo spustit. Zkontroluj, že prohlížeč povoluje lokální úložiště.');
    }
  }

  init();
})();
