(() => {
  'use strict';

  // ============================================================================
  // KONFIGURACE SPOLEČNÉ SUPABASE DATABÁZE
  // Načítá se automaticky z GitHub Secrets (SUPABASE_URL a SUPABASE_ANON_KEY)
  // přes config.js, nebo lokálně z paměti prohlížeče.
  // ============================================================================
  const DEFAULT_SUPABASE_CONFIG = {
    url: window.DOCHAZKA_CONFIG?.supabaseUrl || '',
    anonKey: window.DOCHAZKA_CONFIG?.supabaseAnonKey || ''
  };

  const DB_NAME = 'dochazka-win11-db';
  const DB_VERSION = 3;
  const LS_SUPABASE_KEY = 'dochazka_supabase_config_v2';
  const LS_USER_KEY = 'dochazka_active_user_v2';
  const LS_REMEMBER_KEY = 'dochazka_remember_login_v1';
  const LS_BIOMETRICS_KEY = 'dochazka_biometrics_cred_v1';
  const APP_VERSION = 'v2.4.0';
  const APP_BUILD_DATE = '2026.10';
  const APP_SW_CACHE = 'Cache v9';

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
    theme: 'system'
  };

  const TYPE_LABELS = {
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

  const SHORT_TYPE_LABELS = {
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

  const MONTH_NAMES_CS = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
  ];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let db;
  let settings = structuredClone(DEFAULT_SETTINGS);
  let records = new Map();
  let calendarMonth = startOfMonth(new Date());
  let timesheetMonth = startOfMonth(new Date());
  let pickerSelectedYear = new Date().getFullYear();
  let pickerTarget = 'calendar'; // 'calendar' | 'timesheet'
  let editingOriginal = null;
  let toastTimer = null;
  let activeShiftTimerInterval = null;

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
  function fmtDayFull(date) { return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date); }
  function fmtDayShort(date) { return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(date); }
  function fmtWeekdayShort(date) { return new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' }).format(date); }
  function fmtMonthTitle(date) { return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(date); }

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
  // PRACOVNÍ ROZVRH A VÝPOČTY METRIK
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
    return {
      date: key,
      type: scheduled ? 'work' : (isPublicHoliday(key) ? 'holiday' : 'work'),
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
  // INDEXEDDB LOKÁLNÍ ÚLOŽIŠTĚ
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
        console.warn('Cloud sync selhal:', err);
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
        console.warn('Smazání v cloudu selhalo:', err);
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
  // SUPABASE CLOUD SYNC & AUTHENTICATION
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

  function isBuiltInSupabase() {
    return Boolean(DEFAULT_SUPABASE_CONFIG.url && DEFAULT_SUPABASE_CONFIG.anonKey);
  }

  function isSupabaseConfigured() {
    return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
  }

  function loadCurrentUser() {
    try {
      const remember = localStorage.getItem(LS_REMEMBER_KEY);
      if (remember === 'false') {
        // Uživatel si nepřál trvalé uložení přihlášení
        return JSON.parse(sessionStorage.getItem(LS_USER_KEY) || 'null');
      }
      return JSON.parse(localStorage.getItem(LS_USER_KEY) || sessionStorage.getItem(LS_USER_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function saveCurrentUser(user, remember = true) {
    currentUser = user;
    if (user) {
      if (remember) {
        localStorage.setItem(LS_REMEMBER_KEY, 'true');
        localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
        sessionStorage.removeItem(LS_USER_KEY);
      } else {
        localStorage.setItem(LS_REMEMBER_KEY, 'false');
        localStorage.removeItem(LS_USER_KEY);
        sessionStorage.setItem(LS_USER_KEY, JSON.stringify(user));
      }
    } else {
      localStorage.removeItem(LS_USER_KEY);
      sessionStorage.removeItem(LS_USER_KEY);
    }
  }

  // ============================================================================
  // BIOMETRICKÉ OVĚŘENÍ (WebAuthn / Windows Hello / Touch ID / Face ID)
  // ============================================================================
  function isBiometricsSupported() {
    return Boolean(window.PublicKeyCredential && navigator.credentials);
  }

  function getSavedBiometricsCredentials() {
    try {
      return JSON.parse(localStorage.getItem(LS_BIOMETRICS_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function saveBiometricsCredentials(cred) {
    if (cred) localStorage.setItem(LS_BIOMETRICS_KEY, JSON.stringify(cred));
    else localStorage.removeItem(LS_BIOMETRICS_KEY);
  }

  async function registerBiometricsForCurrentUser(pin) {
    if (!isBiometricsSupported()) {
      throw new Error('Tento prohlížeč nebo zařízení nepodporuje biometrické ověření (WebAuthn).');
    }
    if (!currentUser) throw new Error('Musíš být přihlášen.');

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new TextEncoder().encode(currentUser.username);

    const publicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: 'Osobní docházka',
        id: window.location.hostname || 'localhost'
      },
      user: {
        id: userId,
        name: currentUser.username,
        displayName: currentUser.displayName || currentUser.username
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    };

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (credential) {
      const rawId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      saveBiometricsCredentials({
        id: rawId,
        username: currentUser.username,
        pinHash: currentUser.pinHash,
        displayName: currentUser.displayName,
        role: currentUser.role || 'employee',
        userKey: currentUser.userKey,
        enabledAt: new Date().toISOString()
      });
      return true;
    }
    return false;
  }

  async function authenticateWithBiometrics() {
    if (!isBiometricsSupported()) throw new Error('Biometrické ověření není podporováno.');
    const saved = getSavedBiometricsCredentials();
    if (!saved || !saved.id || !saved.username) {
      throw new Error('Na tomto zařízení dosud není zaregistrována žádná biometrika. Přihlas se nejdříve jménem a PINem a biometriku povol v Nastavení.');
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const credentialId = Uint8Array.from(atob(saved.id), c => c.charCodeAt(0));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: credentialId,
          type: 'public-key',
          transports: ['internal']
        }],
        userVerification: 'required',
        timeout: 60000
      }
    });

    if (assertion) {
      // Úspěšné biometrické ověření uživatele -> obnovíme přihlášenou relaci
      const candidateUser = {
        userKey: saved.userKey,
        username: saved.username,
        displayName: saved.displayName,
        pinHash: saved.pinHash,
        role: saved.role || 'employee'
      };

      saveCurrentUser(candidateUser, true);
      renderAll();
      if (isCloudReady()) {
        syncWithSupabase(false).catch(console.warn);
      }
      return `Vítej zpět, ${candidateUser.displayName}! (Ověřeno biometrikou)`;
    }
    throw new Error('Biometrické ověření selhalo.');
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
    await sbFetch(`/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.userKey)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
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

  // ============================================================================
  // SAMOSTATNÉ PŘIHLÁŠENÍ & REGISTRACE
  // ============================================================================
  async function performLogin(usernameInput, pinInput, rememberMe = true) {
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno.');
    if (!pinInput) throw new Error('Zadej svůj PIN nebo heslo.');

    const userKey = `user:${cleanUser}`;
    const pinHash = await hashPin(pinInput, cleanUser);
    const candidateUser = { userKey, username: cleanUser, pinHash };

    if (isSupabaseConfigured()) {
      setSyncState('syncing');
      try {
        const rows = await sbFetch(
          `/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(userKey)}&select=*`,
          { authUser: candidateUser }
        );
        const profile = rows?.[0];
        if (!profile) {
          throw new Error(`Uživatel "${cleanUser}" nebyl nalezen nebo byl zadán chybný PIN.`);
        }

        saveCurrentUser({
          userKey,
          username: cleanUser,
          displayName: profile.display_name || cleanUser,
          pinHash,
          role: profile.role || 'employee'
        }, rememberMe);
        applySettingsFromProfileRow(profile);
        await saveSettings(true);
        applyTheme();
        await syncWithSupabase(false);
        return `Vítej zpět, ${currentUser.displayName}!`;
      } catch (err) {
        setSyncState('error');
        throw err;
      }
    } else {
      // Lokální profil bez cloudu
      saveCurrentUser({
        userKey,
        username: cleanUser,
        displayName: cleanUser,
        pinHash,
        role: 'admin'
      }, rememberMe);
      setSyncState('local');
      renderAll();
      return `Přihlášen lokální profil ${cleanUser}.`;
    }
  }

  async function performRegister(usernameInput, displayNameInput, pinInput, pinConfirmInput, inviteCodeInput, mergeLocal) {
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno (písmena, číslice).');
    if (!displayNameInput.trim()) throw new Error('Zadej celé jméno na výkaz.');
    if (!pinInput) throw new Error('Zadej svůj PIN nebo heslo.');
    if (pinInput !== pinConfirmInput) throw new Error('Zadaná hesla/PINy se neshodují.');

    const userKey = `user:${cleanUser}`;
    const pinHash = await hashPin(pinInput, cleanUser);
    let assignedRole = 'employee';

    if (isSupabaseConfigured()) {
      setSyncState('syncing');
      try {
        const cleanInvite = (inviteCodeInput || '').trim().toUpperCase();

        // Kontrola, zda v DB již existují uživatelé – pokud ano, kód pozvánky je povinný!
        try {
          const checkUsers = await sbFetch('/rest/v1/attendance_profiles?select=user_key&limit=1');
          if (checkUsers && checkUsers.length > 0 && !cleanInvite) {
            throw new Error('Registrace nových uživatelů je v režimu Invite-Only. Zadej platný kód pozvánky od správce.');
          }
        } catch (checkErr) {
          if (checkErr.message && checkErr.message.includes('Invite-Only')) throw checkErr;
        }

        // Registrace přes zabezpečenou RPC funkci s kontrolou pozvánky
        const rpcRes = await sbFetch('/rest/v1/rpc/register_user_with_invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_username: cleanUser,
            p_display_name: displayNameInput.trim(),
            p_pin_hash: pinHash,
            p_invite_code: cleanInvite
          })
        });

        if (rpcRes && rpcRes.role) {
          assignedRole = rpcRes.role;
        }

        const candidateUser = {
          userKey,
          username: cleanUser,
          displayName: displayNameInput.trim(),
          pinHash,
          role: assignedRole
        };

        // Aktualizujeme profil o výchozí rozvrh
        const row = profileRowFromSettings(candidateUser);
        row.role = assignedRole;
        await sbFetch(`/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(userKey)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(row),
          authUser: candidateUser
        });

        saveCurrentUser(candidateUser);
        await syncWithSupabase(mergeLocal);
        return assignedRole === 'admin'
          ? `Účet "${cleanUser}" byl vytvořen s rolí Správce (Admin)!`
          : `Účet "${cleanUser}" byl úspěšně vytvořen!`;
      } catch (err) {
        setSyncState('error');
        if (err.status === 409 || /duplicate|unique|již existuje/i.test(err.message)) {
          throw new Error(`Uživatelské jméno "${cleanUser}" je již obsazeno. Zvol jiné.`);
        }
        throw err;
      }
    } else {
      const candidateUser = {
        userKey,
        username: cleanUser,
        displayName: displayNameInput.trim(),
        pinHash,
        role: 'admin'
      };
      saveCurrentUser(candidateUser);
      setSyncState('local');
      renderAll();
      return `Lokální účet "${cleanUser}" vytvořen.`;
    }
  }

  async function performChangePin(oldPin, newPin, newPinConfirm) {
    if (!currentUser) throw new Error('Pro změnu PINu musíš být přihlášen.');
    if (!oldPin) throw new Error('Zadej svůj současný PIN / heslo.');
    if (!newPin) throw new Error('Zadej nový PIN / heslo.');
    if (newPin.length < 4) throw new Error('Nový PIN / heslo musí mít alespoň 4 znaky.');
    if (newPin !== newPinConfirm) throw new Error('Nový PIN a jeho potvrzení se neshodují.');
    if (oldPin === newPin) throw new Error('Nový PIN musí být jiný než současný.');

    const oldHash = await hashPin(oldPin, currentUser.username);
    if (oldHash !== currentUser.pinHash) {
      throw new Error('Zadaný současný PIN není správný.');
    }

    const newHash = await hashPin(newPin, currentUser.username);

    if (isCloudReady()) {
      setSyncState('syncing');
      try {
        await sbFetch(`/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.userKey)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            pin_hash: newHash,
            updated_at: new Date().toISOString()
          }),
          authUser: currentUser
        });

        currentUser.pinHash = newHash;
        saveCurrentUser(currentUser);
        setSyncState('online');
        return 'PIN byl úspěšně změněn a aktualizován v cloudu.';
      } catch (err) {
        setSyncState('error');
        throw new Error(`Změna PINu v databázi selhala: ${err.message}`);
      }
    } else {
      currentUser.pinHash = newHash;
      saveCurrentUser(currentUser);
      return 'PIN byl úspěšně změněn (lokální profil).';
    }
  }

  async function syncWithSupabase(pushLocalDays = true) {
    if (!isCloudReady()) {
      setSyncState('local');
      return;
    }
    setSyncState('syncing');
    try {
      const profRows = await sbFetch(
        `/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.userKey)}&select=*`
      );
      if (profRows?.[0]) {
        applySettingsFromProfileRow(profRows[0]);
        let userUpdated = false;
        if (profRows[0].display_name && currentUser.displayName !== profRows[0].display_name) {
          currentUser.displayName = profRows[0].display_name;
          userUpdated = true;
        }
        if (profRows[0].role && currentUser.role !== profRows[0].role) {
          currentUser.role = profRows[0].role;
          userUpdated = true;
        }

        // Pokud uživatel dosud nemá roli 'admin', zkusíme automaticky zjistit, zda v DB
        // existuje nějaký správce. Pokud ne, uživatel je povýšen na Správce!
        if (currentUser.role !== 'admin') {
          try {
            const claimRes = await sbFetch('/rest/v1/rpc/claim_initial_admin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}'
            });
            if (claimRes && claimRes.role === 'admin') {
              currentUser.role = 'admin';
              userUpdated = true;
            }
          } catch {
            // Ignorováno – neběží v admin claim režimu
          }
        }

        if (userUpdated) {
          saveCurrentUser(currentUser);
        }
        await saveSettings(true);
        applyTheme();
        renderAuthAndSyncUI();
      }

      const remoteRows = await sbFetch(
        `/rest/v1/attendance_days?user_key=eq.${encodeURIComponent(currentUser.userKey)}&select=*&order=date.asc`
      );
      const remoteMap = new Map((remoteRows || []).map(r => [r.date, localDayFromSupabaseRow(r)]));

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

      const tx = db.transaction(['days'], 'readwrite');
      const store = tx.objectStore('days');
      store.clear();
      for (const day of remoteMap.values()) store.put(day);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });

      records = remoteMap;
      setSyncState('online');
      renderAll();
    } catch (err) {
      console.error('Chyba synchronizace:', err);
      setSyncState('error');
      throw err;
    }
  }

  // ============================================================================
  // STATISTIKY
  // ============================================================================
  function yearVacationUsed(year) {
    let used = 0;
    for (const [key, day] of records.entries()) {
      if (!key.startsWith(`${year}-`)) continue;
      if (day.type === 'vacation') used += 1;
      else if (day.type === 'halfVacation') used += 0.5;
    }
    return used;
  }

  function monthVacationDays(monthDate) {
    const y = monthDate.getFullYear();
    const m = String(monthDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${y}-${m}-`;
    let used = 0;
    for (const [key, day] of records.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (day.type === 'vacation') used += 1;
      else if (day.type === 'halfVacation') used += 0.5;
    }
    return used;
  }

  function formatVacationDays(n) {
    if (n === 1) return '1 den';
    if (n >= 2 && n <= 4) return `${n} dny`;
    return `${n.toLocaleString('cs-CZ')} dnů`;
  }

  function monthStats(monthDate) {
    const year = monthDate.getFullYear(), month = monthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayKey();
    let fund = 0, worked = 0, credited = 0, balance = 0, recorded = 0, missing = 0;
    let scheduledWorkdays = 0, weekendWorked = 0, totalBreaks = 0;

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

  // ============================================================================
  // VYKRESLENÍ UI
  // ============================================================================
  function applyTheme() {
    if (settings.theme === 'light' || settings.theme === 'dark') {
      document.documentElement.dataset.theme = settings.theme;
    } else {
      document.documentElement.dataset.theme = 'system';
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
    if (ordered.join(',') === '1,2,3,4,5,6') return 'Po–So';
    if (ordered.join(',') === '1,2,3,4,5,6,0') return 'Po–Ne';
    return ordered.map(d => mapNames[d]).join(', ') || 'Bez rozvrhu';
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

  function updateActiveShiftTimer() {
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

  function renderAuthAndSyncUI() {
    const name = currentUser ? (currentUser.displayName || currentUser.username) : 'Nepřihlášen';
    const initials = currentUser
      ? (currentUser.displayName || currentUser.username).split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
      : '?';

    $('#sidebarAvatar').textContent = initials;
    $('#headerAvatar').textContent = initials;
    $('#accountAvatar').textContent = initials;

    $('#sidebarUserName').textContent = name;
    $('#headerUserName').textContent = currentUser ? name : 'Přihlásit se';
    $('#accountFullName').textContent = currentUser ? currentUser.displayName : 'Nepřihlášený uživatel';
    $('#accountUsername').textContent = currentUser ? `@${currentUser.username}` : 'Lokální data v tomto zařízení';

    const cloudWidget = $('#cloudStatusBadge');
    const cloudLabel = $('#cloudStatusLabel');
    const sideStatusPill = $('#sidebarUserStatus');
    const sideStatusText = $('#sidebarStatusText');
    const accSyncBadge = $('#accountSyncBadge');

    cloudWidget.className = 'cloud-status-widget';
    sideStatusPill.className = 'status-indicator-pill';
    accSyncBadge.className = 'status-indicator-pill';

    if (isCloudReady()) {
      if (syncState === 'syncing') {
        cloudWidget.classList.add('syncing');
        cloudLabel.textContent = 'Synchronizuji…';
        sideStatusText.textContent = 'Synchronizuji…';
        accSyncBadge.textContent = 'Synchronizace probíhá';
      } else if (syncState === 'error') {
        cloudWidget.classList.add('error');
        cloudLabel.textContent = 'Chyba spojení';
        sideStatusText.textContent = 'Chyba spojení';
        accSyncBadge.textContent = 'Chyba spojení se Supabase';
      } else {
        cloudWidget.classList.add('online');
        sideStatusPill.classList.add('online');
        accSyncBadge.classList.add('online');
        cloudLabel.textContent = 'Online';
        sideStatusText.textContent = 'Cloud aktivní';
        accSyncBadge.textContent = 'Supabase synchronizováno';
      }
    } else if (isSupabaseConfigured()) {
      cloudLabel.textContent = 'DB připravena';
      sideStatusText.textContent = 'Přihlas se';
      accSyncBadge.textContent = 'Databáze připravena – přihlas se';
    } else {
      cloudLabel.textContent = 'Lokální režim';
      sideStatusText.textContent = 'Lokální';
      accSyncBadge.textContent = 'Pouze lokální úložiště';
    }

    const builtIn = isBuiltInSupabase();
    $('#supabaseAutoDetectedBanner')?.classList.toggle('hidden', !builtIn);
    $('#supabaseManualConfigBox')?.classList.toggle('hidden', builtIn);

    $('#openLoginModalBtn')?.classList.toggle('hidden', !!currentUser);
    $('#openRegisterModalBtn')?.classList.toggle('hidden', !!currentUser);
    $('#openChangePinModalBtn')?.classList.toggle('hidden', !currentUser);
    $('#logoutUserBtn')?.classList.toggle('hidden', !currentUser);

    // Tlačítko pro biometrii v nastavení (pouze když je uživatel přihlášen a biometrika podporována)
    const canBiometric = isBiometricsSupported() && !!currentUser;
    $('#enableBiometricsBtn')?.classList.toggle('hidden', !canBiometric);

    // V dialogu přihlášení zobrazit tlačítko biometrie, pokud existuje uložená registrace
    const savedBio = getSavedBiometricsCredentials();
    $('#biometricLoginRow')?.classList.toggle('hidden', !savedBio);

    // Správa týmu (pouze pro roli admin)
    const isAdmin = currentUser?.role === 'admin';
    $('#navItemTeam')?.classList.toggle('hidden', !isAdmin);
    $('#mNavItemTeam')?.classList.toggle('hidden', !isAdmin);
    $('#openTeamFromSettingsBtn')?.classList.toggle('hidden', !isAdmin);
    $('#settingsTeamCard')?.classList.toggle('hidden', !isAdmin);
    $('#claimAdminBtn')?.classList.toggle('hidden', !currentUser || isAdmin);

    const roleBadge = $('#accountRoleBadge');
    if (roleBadge) {
      if (currentUser) {
        roleBadge.classList.remove('hidden');
        if (isAdmin) {
          roleBadge.className = 'role-badge admin';
          roleBadge.textContent = 'Správce (Admin)';
        } else {
          roleBadge.className = 'role-badge employee';
          roleBadge.textContent = 'Zaměstnanec';
        }
      } else {
        roleBadge.classList.add('hidden');
      }
    }

    if (isAdmin) {
      $('#sidebarUserStatus')?.classList.remove('local');
      $('#sidebarUserStatus')?.classList.add('online');
      $('#sidebarStatusText').textContent = 'Správce (Admin)';
      $('#accountSyncBadge').textContent = 'Správce (Admin)';
      $('#accountSyncBadge').className = 'status-indicator-pill online';
    }

    // Sidebar rozvrh
    $('#sidebarPlanDays').textContent = formatScheduleDaysSummary();
    $('#sidebarPlanHours').textContent = `${settings.workStart} – ${settings.workEnd}`;
    $('#sidebarPlanTarget').textContent = `Denní fond: ${formatDuration(settings.dailyTargetMinutes)}`;
  }

  // Alias pro zpětnou kompatibilitu a bezpečnost (hoisted)
  function renderProfile() {
    renderAuthAndSyncUI();
  }

  function renderTodayDashboard() {
    const now = new Date();
    const key = localDateKey(now);
    const rec = records.get(key);
    const hours = defaultHoursForDate(key);
    const holiday = holidayName(key);

    $('#todayDateLabel').textContent = fmtDayFull(now);
    $('#todayTypeBadge').textContent = rec
      ? TYPE_LABELS[rec.type]
      : (holiday || (isScheduledWorkday(now) ? 'Pracovní den' : (isWeekendDate(now) ? 'Víkend' : 'Volno')));

    const holidayBadge = $('#todayHolidayBadge');
    if (holidayBadge) {
      if (holiday) {
        holidayBadge.textContent = holiday;
        holidayBadge.hidden = false;
        holidayBadge.style.display = 'inline-flex';
        holidayBadge.classList.remove('hidden');
      } else {
        holidayBadge.textContent = '';
        holidayBadge.hidden = true;
        holidayBadge.style.display = 'none';
        holidayBadge.classList.add('hidden');
      }
    }

    if (rec && (rec.start || rec.end)) {
      $('#todayShiftTimes').textContent = `${rec.start || '?'} – ${rec.end || 'dosud'}`;
    } else {
      $('#todayShiftTimes').textContent = `${hours.start} – ${hours.end}`;
    }

    const target = rec ? targetForDay(rec) : baseTargetForDate(key);
    const metrics = rec ? dayMetrics(rec) : { worked: 0, credited: 0, balance: 0, target, breakMinutes: 0 };

    $('#todayWorkedVal').textContent = formatDuration(metrics.worked);
    $('#todayCreditedVal').textContent = formatDuration(metrics.credited);
    $('#todayBreakVal').textContent = `${metrics.breakMinutes} min`;
    $('#todayTargetVal').textContent = formatDuration(target);

    $('#todayBalanceVal').textContent = rec ? formatDuration(metrics.balance, true) : '0:00';
    setBalanceClass($('#todayBalanceVal'), rec ? metrics.balance : 0);

    if (rec) {
      const diff = metrics.balance;
      $('#todayBalanceSub').textContent = diff > 0 ? `Přesčas +${formatDuration(diff)}` : diff < 0 ? `Chybí ${formatDuration(Math.abs(diff))}` : 'Přesně podle fondu';
    } else {
      $('#todayBalanceSub').textContent = isScheduledWorkday(now) ? 'Směna dosud nebyla zaznamenána' : 'Dnes není plánovaná směna';
    }

    const totalCounted = metrics.worked + metrics.credited;
    const pct = target > 0 ? clamp(Math.round((totalCounted / target) * 100), 0, 100) : (totalCounted > 0 ? 100 : 0);
    $('#todayProgressText').textContent = `${pct} %`;
    $('#todayProgressBar').style.width = `${pct}%`;

    const remaining = Math.max(0, target - totalCounted);
    $('#todayProgressSub').textContent = remaining > 0 ? `Zbývá ${formatDuration(remaining)} do splnění fondu` : 'Denní cíl splněn!';

    $('#dashNormalHoursHint').textContent = `${hours.start} – ${hours.end} (fond ${formatDuration(hours.target)})`;

    renderWeekStrip(now);
    updateGreeting();
    updateActiveShiftTimer();

    // Měsíční KPI na Dashboardu
    const st = monthStats(startOfMonth(now));
    $('#monthKpiNameLabel').textContent = fmtMonthTitle(now);
    $('#kpiMonthBalance').textContent = formatDuration(st.balance, true);
    setBalanceClass($('#kpiMonthBalance'), st.balance);
    $('#kpiMonthBalanceSub').textContent = st.balance > 0 ? 'přesčasy' : st.balance < 0 ? 'nedoplatek fondu' : 'vyrovnáno';
    $('#kpiMonthWorked').textContent = formatDuration(st.worked);
    $('#kpiMonthWorkedSub').textContent = `z fondu ${formatDuration(st.fund)}`;
    $('#kpiMonthCredited').textContent = formatDuration(st.credited);
    $('#kpiMonthMissing').textContent = String(st.missing);
  }

  function renderWeekStrip(refDate) {
    const strip = $('#dashboardWeekStrip');
    if (!strip) return;
    strip.innerHTML = '';
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

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'week-day-card';
      if (key === today) card.classList.add('today');

      const hoursText = rec
        ? (m.worked > 0 ? formatDuration(m.worked) : SHORT_TYPE_LABELS[rec.type] || '—')
        : (isScheduledWorkday(d) ? '—' : 'Volno');

      card.innerHTML = `
        <span class="week-day-name">${fmtWeekdayShort(d)}</span>
        <span class="week-day-number">${d.getDate()}</span>
        <span class="cal-dot ${status}"></span>
        <span class="week-day-hours">${hoursText}</span>
      `;
      card.addEventListener('click', () => openDayEditor(key));
      strip.appendChild(card);
    }
  }

  function statusClassForDay(key, rec) {
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
    if (baseTargetForDate(key) > 0 && key < todayKey()) return 'missing';
    return '';
  }

  // ============================================================================
  // KALENDÁŘ SMĚN
  // ============================================================================
  function renderCalendar() {
    $('#calCurrentMonthTitle').textContent = fmtMonthTitle(calendarMonth);
    $('#calScheduleHint').textContent = `Rozvrh: ${formatScheduleDaysSummary()} · ${settings.workStart}–${settings.workEnd}`;

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
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day-cell';
      if (!isSameMonth(date, calendarMonth)) cell.classList.add('outside');
      if (isWeekendDate(date)) {
        cell.classList.add('weekend');
        if (isScheduledWorkday(date)) cell.classList.add('scheduled-weekend');
      }
      if (key === today) cell.classList.add('today');

      const status = statusClassForDay(key, rec);
      const m = rec ? dayMetrics(rec) : null;
      const h = holidayName(key);

      let timeText = '';
      let tagText = '';
      if (rec) {
        if (m.worked > 0) {
          timeText = rec.start && rec.end ? `${rec.start}–${rec.end}` : formatDuration(m.worked);
          tagText = formatDuration(m.worked);
        } else {
          timeText = SHORT_TYPE_LABELS[rec.type];
          tagText = m.credited > 0 ? formatDuration(m.credited) : '';
        }
      } else if (h) {
        timeText = 'Svátek';
      } else if (isScheduledWorkday(date) && isSameMonth(date, calendarMonth) && key < today) {
        timeText = 'Chybí';
      }

      cell.innerHTML = `
        <div class="cal-day-top">
          <span class="cal-day-num">${date.getDate()}</span>
          <span class="cal-dot ${status}"></span>
        </div>
        <div class="cal-day-bottom">
          <span class="cal-time-range">${timeText}</span>
          ${tagText ? `<span class="cal-tag-pill">${tagText}</span>` : ''}
        </div>
      `;
      cell.title = rec ? `${TYPE_LABELS[rec.type]}${rec.note ? ` (${rec.note})` : ''}` : (h || '');
      cell.addEventListener('click', () => openDayEditor(key));
      grid.appendChild(cell);
    }

    // Boční panel v kalendáři
    const st = monthStats(calendarMonth);
    $('#calSideFund').textContent = formatDuration(st.fund);
    $('#calSideWorked').textContent = formatDuration(st.worked);
    $('#calSideBalance').textContent = formatDuration(st.balance, true);
    setBalanceClass($('#calSideBalance'), st.balance);

    const listEl = $('#calMonthRecordsList');
    listEl.innerHTML = '';
    const prefix = `${calendarMonth.getFullYear()}-${pad(calendarMonth.getMonth() + 1)}-`;
    const monthRecords = [...records.values()]
      .filter(r => r.date.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date));

    $('#calRecordsCountBadge').textContent = `${monthRecords.length} dnů`;

    if (monthRecords.length === 0) {
      listEl.innerHTML = `<p class="muted" style="margin: 8px 0; font-size: 13px;">V tomto měsíci zatím nejsou uložené záznamy.</p>`;
    } else {
      for (const rec of monthRecords) {
        const d = parseDateKey(rec.date);
        const m = dayMetrics(rec);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'cal-record-item';
        const hoursStr = rec.start && rec.end ? `${rec.start}–${rec.end}` : TYPE_LABELS[rec.type];
        item.innerHTML = `
          <div class="cal-rec-left">
            <strong>${d.getDate()}. ${d.getMonth() + 1}. · ${TYPE_LABELS[rec.type]}</strong>
            <small>${hoursStr}${rec.note ? ` · ${rec.note}` : ''}</small>
          </div>
          <div class="cal-rec-right">
            <strong>${formatDuration(m.worked || m.credited)}</strong>
            <small class="${m.balance > 0 ? 'positive' : m.balance < 0 ? 'negative' : ''}">${formatDuration(m.balance, true)}</small>
          </div>
        `;
        item.addEventListener('click', () => openDayEditor(rec.date));
        listEl.appendChild(item);
      }
    }
  }

  // ============================================================================
  // WINDOWS 11 MONTH & YEAR PICKER (ZOBRAZENÍ MĚSÍCŮ PŘI KLIKNUTÍ)
  // ============================================================================
  function openMonthPicker(targetView) {
    pickerTarget = targetView;
    const currentRef = targetView === 'timesheet' ? timesheetMonth : calendarMonth;
    pickerSelectedYear = currentRef.getFullYear();
    renderMonthPickerGrid();
    $('#monthPickerModal').showModal();
  }

  function renderMonthPickerGrid() {
    $('#pickerYearDisplay').textContent = String(pickerSelectedYear);
    const grid = $('#monthPickerGrid');
    grid.innerHTML = '';

    const currentRef = pickerTarget === 'timesheet' ? timesheetMonth : calendarMonth;
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();

    for (let m = 0; m < 12; m++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'month-picker-cell';
      btn.textContent = MONTH_NAMES_CS[m];

      if (pickerSelectedYear === currentRef.getFullYear() && m === currentRef.getMonth()) {
        btn.classList.add('selected');
      }
      if (pickerSelectedYear === curYear && m === curMonth) {
        btn.classList.add('current-month');
      }

      btn.addEventListener('click', () => {
        const targetDate = new Date(pickerSelectedYear, m, 1, 12);
        if (pickerTarget === 'timesheet') {
          timesheetMonth = targetDate;
          renderTimesheet();
        } else {
          calendarMonth = targetDate;
          renderCalendar();
        }
        $('#monthPickerModal').close();
      });

      grid.appendChild(btn);
    }
  }

  // ============================================================================
  // MĚSÍČNÍ VÝKAZ DOCHÁZKY (TIMESHEET & TISK)
  // ============================================================================
  function renderTimesheet() {
    $('#tsMonthTitle').textContent = fmtMonthTitle(timesheetMonth);
    const userLabel = currentUser ? (currentUser.displayName || currentUser.username) : 'Lokální uživatel';

    // Data pro tisk
    $('#printEmployeeName').textContent = userLabel;
    $('#printMonthPeriod').textContent = fmtMonthTitle(timesheetMonth);

    const s = monthStats(timesheetMonth);
    $('#tsBalanceTotal').textContent = formatDuration(s.balance, true);
    setBalanceClass($('#tsBalanceTotal'), s.balance);
    $('#tsBalanceStatus').textContent = s.balance > 0 ? 'nadpracováno' : s.balance < 0 ? 'nedoplatek' : 'vyrovnáno';

    $('#tsFundTotal').textContent = formatDuration(s.fund);
    $('#tsWorkdaysCount').textContent = `${s.scheduledWorkdays} pracovních dnů`;

    $('#tsWorkedTotal').textContent = formatDuration(s.worked);
    $('#tsWeekendWorkedInfo').textContent = s.weekendWorked > 0 ? `z toho víkendy ${formatDuration(s.weekendWorked)}` : 'bez víkendů';

    $('#tsCreditedTotal').textContent = formatDuration(s.credited);
    $('#tsBreaksTotal').textContent = formatDuration(s.totalBreaks);

    const year = timesheetMonth.getFullYear();
    const usedVacYear = yearVacationUsed(year);
    const usedVacMonth = monthVacationDays(timesheetMonth);

    const vacDaysEl = $('#tsVacationDays') || $('#tsVacationRemaining');
    if (vacDaysEl) {
      vacDaysEl.textContent = formatVacationDays(usedVacYear);
    }
    const vacInfoEl = $('#tsVacationInfo') || $('#tsVacationUsed');
    if (vacInfoEl) {
      vacInfoEl.textContent = usedVacMonth > 0
        ? `${usedVacMonth.toLocaleString('cs-CZ')} d. tento měsíc · rok ${year}: celkem dovolená ${formatVacationDays(usedVacYear)}`
        : `rok ${year}: celkem dovolená ${formatVacationDays(usedVacYear)}`;
    }

    $('#printFundTotal').textContent = formatDuration(s.fund);
    $('#printWorkedTotal').textContent = formatDuration(s.worked + s.credited);

    // Tabulka
    const tbody = $('#timesheetTableBody');
    tbody.innerHTML = '';
    const daysInMonth = new Date(year, timesheetMonth.getMonth() + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, timesheetMonth.getMonth(), d, 12);
      const key = localDateKey(dateObj);
      const rec = records.get(key);
      const m = rec ? dayMetrics(rec) : null;
      const h = holidayName(key);

      const tr = document.createElement('tr');
      if (isWeekendDate(dateObj)) tr.classList.add('weekend-row');

      const typeLabel = rec ? TYPE_LABELS[rec.type] : (h ? `Svátek (${h})` : (isWeekendDate(dateObj) ? 'Víkend' : '—'));
      const workedText = rec ? formatDuration(m.worked) : '—';
      const creditedText = rec && m.credited > 0 ? formatDuration(m.credited) : '—';
      const balanceText = rec ? formatDuration(m.balance, true) : '—';
      const balanceClass = rec ? (m.balance > 0 ? 'positive' : m.balance < 0 ? 'negative' : '') : '';

      tr.innerHTML = `
        <td><strong>${d}.${timesheetMonth.getMonth() + 1}.</strong></td>
        <td>${fmtWeekdayShort(dateObj)}</td>
        <td>${typeLabel}</td>
        <td>${rec?.start || '—'}</td>
        <td>${rec?.end || '—'}</td>
        <td>${rec && m.breakMinutes > 0 ? `${m.breakMinutes}m` : '—'}</td>
        <td><strong>${workedText}</strong></td>
        <td>${creditedText}</td>
        <td class="${balanceClass}"><strong>${balanceText}</strong></td>
        <td>${rec?.note || ''}</td>
      `;
      tr.addEventListener('click', () => openDayEditor(key));
      tbody.appendChild(tr);
    }

    // Součtový řádek (tfoot)
    const tfoot = $('#timesheetTableFoot');
    tfoot.innerHTML = `
      <tr>
        <td colspan="6"><strong>CELKEM ZA MĚSÍC</strong></td>
        <td><strong>${formatDuration(s.worked)}</strong></td>
        <td><strong>${formatDuration(s.credited)}</strong></td>
        <td class="${s.balance > 0 ? 'positive' : s.balance < 0 ? 'negative' : ''}"><strong>${formatDuration(s.balance, true)}</strong></td>
        <td>Fond: ${formatDuration(s.fund)}</td>
      </tr>
    `;
  }

  // ============================================================================
  // NASTAVENÍ FORMULÁŘ
  // ============================================================================
  function renderSettings() {
    $('#setWorkStart').value = settings.workStart;
    $('#setWorkEnd').value = settings.workEnd;
    $('#setDailyTarget').value = minutesToTime(settings.dailyTargetMinutes);
    $('#setBreakMinutes').value = settings.breakMinutes;
    $('#setBreakAfterMinutes').value = settings.breakAfterMinutes;
    $('#setAutoFill').checked = !!settings.autoFill;
    $('#setThemeMode').value = settings.theme;

    // Víkendy
    $('#setWeekendMode').value = settings.weekendMode || 'none';
    const days = activeWorkDays();
    $$('#weekdaysCheckboxes input[type="checkbox"]').forEach(cb => {
      cb.checked = days.includes(Number(cb.value));
    });

    $('#setWeekendCustomHours').checked = !!settings.weekendCustomHours;
    $('#weekendCustomInputsArea').classList.toggle('hidden', !settings.weekendCustomHours);
    $('#setWeekendStart').value = settings.weekendStart || '07:00';
    $('#setWeekendEnd').value = settings.weekendEnd || '15:30';
    $('#setWeekendTarget').value = minutesToTime(settings.weekendTargetMinutes ?? 480);
    $('#setWorkOnHolidays').checked = !!settings.workOnHolidays;

    // Supabase
    $('#setSbUrl').value = supabaseConfig.url || '';
    $('#setSbKey').value = supabaseConfig.anonKey || '';

    // Verze aplikace
    if ($('#appVersionLabel')) $('#appVersionLabel').textContent = APP_VERSION;
    if ($('#appBuildDateLabel')) $('#appBuildDateLabel').textContent = APP_BUILD_DATE;
    if ($('#appCacheVersionLabel')) $('#appCacheVersionLabel').textContent = `${APP_SW_CACHE} (Aktivní)`;

    renderAuthAndSyncUI();
  }

  function renderAll() {
    renderAuthAndSyncUI();
    renderTodayDashboard();
    renderCalendar();
    renderTimesheet();
    renderSettings();
  }

  // ============================================================================
  // NAVIGACE MEZI POHLEDY
  // ============================================================================
  function switchView(viewName) {
    $$('.win11-view').forEach(v => v.classList.remove('active'));
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
    $$('.m-nav-btn').forEach(b => {
      const match = (viewName === 'team') ? (b.dataset.view === 'settings') : (b.dataset.view === viewName);
      b.classList.toggle('active', match);
    });

    const viewEl = $(`#view${viewName[0].toUpperCase()}${viewName.slice(1)}`);
    if (viewEl) viewEl.classList.add('active');

    const titles = {
      dashboard: 'Dnešní přehled',
      calendar: 'Kalendář směn',
      timesheet: 'Měsíční výkaz docházky',
      settings: 'Nastavení a databáze',
      team: 'Správa týmu a pozvánky'
    };
    $('#headerViewTitle').textContent = titles[viewName] || 'Docházka';

    if (viewName === 'calendar') renderCalendar();
    if (viewName === 'timesheet') renderTimesheet();
    if (viewName === 'settings') renderSettings();
    if (viewName === 'team') renderTeamView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ============================================================================
  // DIALOG ÚPRAVY DNE
  // ============================================================================
  function formDayFromInputs() {
    return {
      date: $('#editDayDate').value,
      type: $('#editDayType').value,
      start: $('#editDayStart').value,
      end: $('#editDayEnd').value,
      manualBreak: $('#editManualBreakToggle').checked,
      breakMinutes: Number($('#editDayBreak').value) || 0,
      doctorFullDay: $('#editDoctorFullDay').checked,
      doctorStart: $('#editDoctorStart').value,
      doctorEnd: $('#editDoctorEnd').value,
      otherMinutes: Number($('#editOtherMinutes').value) || 0,
      note: $('#editDayNote').value.trim(),
      updatedAt: new Date().toISOString()
    };
  }

  function fillDayForm(day) {
    $('#editDayDate').value = day.date;
    $('#editDayType').value = day.type;
    $('#editDayStart').value = day.start || '';
    $('#editDayEnd').value = day.end || '';
    $('#editManualBreakToggle').checked = !!day.manualBreak;
    $('#editDayBreak').value = Number.isFinite(Number(day.breakMinutes)) ? Number(day.breakMinutes) : settings.breakMinutes;
    $('#editDoctorFullDay').checked = !!day.doctorFullDay;
    $('#editDoctorStart').value = day.doctorStart || '';
    $('#editDoctorEnd').value = day.doctorEnd || '';
    $('#editOtherMinutes').value = Number(day.otherMinutes) || 0;
    $('#editDayNote').value = day.note || '';
    updateDayFormVisibility();
    updateDayPreview();
  }

  function updateDayFormVisibility() {
    const type = $('#editDayType').value;
    const key = $('#editDayDate').value || todayKey();
    const hours = defaultHoursForDate(key);
    const workAllowed = allowsWork(type) && !(type === 'doctor' && $('#editDoctorFullDay').checked);

    $('#editWorkSection').classList.toggle('hidden', !workAllowed);
    $('#editDoctorSection').classList.toggle('hidden', type !== 'doctor');
    $('#editOtherSection').classList.toggle('hidden', type !== 'other');
    $('#editManualBreakWrap').classList.toggle('hidden', !$('#editManualBreakToggle').checked || !workAllowed);
    $('#editDoctorTimesRow').classList.toggle('hidden', $('#editDoctorFullDay').checked || type !== 'doctor');

    if (workAllowed && settings.autoFill && !$('#editDayStart').value && !$('#editDayEnd').value) {
      $('#editDayStart').value = hours.start;
      $('#editDayEnd').value = hours.end;
    }
  }

  function updateDayPreview() {
    const day = formDayFromInputs();
    const m = dayMetrics(day);
    $('#editAutoBreakText').textContent = day.manualBreak ? `Vlastní ${m.breakMinutes} min` : `Automaticky ${m.breakMinutes} min`;
    $('#prevWorked').textContent = formatDuration(m.worked);
    $('#prevCredited').textContent = formatDuration(m.credited);
    $('#prevTarget').textContent = formatDuration(m.target);
    $('#prevBalance').textContent = formatDuration(m.balance, true);
    setBalanceClass($('#prevBalance'), m.balance);
  }

  function openDayEditor(key) {
    editingOriginal = records.get(key) || null;
    const day = editingOriginal ? structuredClone(editingOriginal) : defaultDay(key);
    const date = parseDateKey(key);
    const holiday = holidayName(key);
    $('#dayDialogDateSub').textContent = isWeekendDate(date) ? 'Víkendový den' : 'Pracovní den';
    $('#dayDialogTitle').textContent = `${fmtDayShort(date)}${holiday ? ` · ${holiday}` : ''}`;
    $('#deleteDayRecordBtn').classList.toggle('hidden', !editingOriginal);
    fillDayForm(day);
    $('#dayEditDialog').showModal();
  }

  async function quickToday(mutator, message = 'Uloženo') {
    const key = todayKey();
    const day = records.get(key) ? structuredClone(records.get(key)) : defaultDay(key);
    mutator(day, defaultHoursForDate(key));
    await saveDay(day);
    toast(message, '✓');
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
      toast('Žádné nevyplněné pracovní dny k doplnění', 'ℹ️');
      return;
    }

    if (!confirm(`Doplnit běžnou pracovní dobu do ${missingKeys.length} nevyplněných pracovních dnů v měsíci ${fmtMonthTitle(monthDate)}?`)) {
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
    toast(`Doplněno ${missingKeys.length} pracovních dnů`, '✓');
  }

  function toast(message, icon = 'ℹ️') {
    const el = $('#win11Toast');
    $('#toastIcon').textContent = icon;
    $('#toastMessage').textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ============================================================================
  // EXPORT CSV & ZÁLOHY
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
    toast('CSV výkaz stažen', '⬇');
  }

  async function exportBackup() {
    const days = [...records.values()].sort((a, b) => a.date.localeCompare(b.date));
    const payload = {
      app: 'osobni-dochazka-win11',
      version: 3,
      exportedAt: new Date().toISOString(),
      user: currentUser ? { username: currentUser.username, displayName: currentUser.displayName } : null,
      settings,
      days
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const fileName = `dochazka-zaloha-${todayKey()}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('JSON záloha exportována', '💾');
  }

  async function importBackup(file) {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!Array.isArray(payload.days)) {
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
    if (!confirm('Opravdu vymazat veškerá lokální data docházky v tomto zařízení?')) return;
    const tx = db.transaction(['days', 'settings'], 'readwrite');
    tx.objectStore('days').clear();
    tx.objectStore('settings').clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    settings = structuredClone(DEFAULT_SETTINGS);
    records.clear();
    await saveSettings(true);
    applyTheme();
    renderAll();
    toast('Lokální data vymazána', '🗑️');
  }

  // ============================================================================
  // SPRÁVA TÝMU & POZVÁNKY (PRO SPRÁVCE)
  // ============================================================================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let teamInvites = [];
  let teamProfiles = [];
  let teamSummaries = [];

  async function renderTeamView() {
    if (currentUser?.role !== 'admin') {
      toast('Tato sekce je přístupná pouze pro správce.', '⚠️');
      switchView('dashboard');
      return;
    }

    const now = new Date();
    $('#teamSummaryMonthLabel').textContent = fmtMonthTitle(now);

    try {
      await Promise.all([
        loadTeamInvites(),
        loadTeamProfiles(),
        loadTeamSummaries()
      ]);
    } catch (err) {
      console.warn('Chyba při načítání týmových dat:', err);
    }
  }

  async function loadTeamInvites() {
    if (!isCloudReady()) return;
    try {
      const rows = await sbFetch('/rest/v1/attendance_invites?order=created_at.desc');
      teamInvites = rows || [];
      renderTeamInvitesTable();
    } catch (err) {
      console.warn('Chyba načtení pozvánek:', err);
    }
  }

  function renderTeamInvitesTable() {
    const tbody = $('#teamInvitesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    $('#invitesCountBadge').textContent = `${teamInvites.length} pozvánek`;

    if (teamInvites.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;" class="muted">Zatím nebyly vytvořeny žádné pozvánky. Klikni nahoře na "Vytvořit pozvánku".</td></tr>`;
      return;
    }

    for (const inv of teamInvites) {
      const tr = document.createElement('tr');
      const roleLabel = inv.target_role === 'admin' ? 'Správce' : 'Zaměstnanec';
      const statusBadge = inv.is_used
        ? `<span class="invite-status-badge used">Využita</span>`
        : `<span class="invite-status-badge unused">Aktivní</span>`;
      const usedByLabel = inv.used_by ? escapeHtml(inv.used_by.replace('user:', '')) : '-';

      tr.innerHTML = `
        <td><strong><code>${escapeHtml(inv.code)}</code></strong></td>
        <td><span class="role-badge ${inv.target_role}">${roleLabel}</span></td>
        <td>${statusBadge}</td>
        <td>${usedByLabel}</td>
        <td>
          <button class="win-btn-standard compact-btn copy-inv-btn" type="button" title="Kopírovat odkaz pozvánky">
            🔗 Odkaz
          </button>
        </td>
      `;

      tr.querySelector('.copy-inv-btn')?.addEventListener('click', () => {
        const url = `${window.location.origin}${window.location.pathname}?invite=${inv.code}`;
        navigator.clipboard?.writeText(url).then(() => {
          toast(`Odkaz s kódem ${inv.code} zkopírován do schránky`, '✓');
        }).catch(() => {
          prompt('Odkaz pozvánky:', url);
        });
      });

      tbody.appendChild(tr);
    }
  }

  async function loadTeamProfiles() {
    if (!isCloudReady()) return;
    try {
      const rows = await sbFetch('/rest/v1/attendance_profiles?order=created_at.asc');
      teamProfiles = rows || [];
      renderTeamProfilesTable();
    } catch (err) {
      console.warn('Chyba načtení profilů:', err);
    }
  }

  function renderTeamProfilesTable() {
    const tbody = $('#teamMembersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    $('#teamMembersCountBadge').textContent = `${teamProfiles.length} uživatelů`;

    if (teamProfiles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;" class="muted">V databázi zatím nejsou žádní uživatelé.</td></tr>`;
      return;
    }

    for (const prof of teamProfiles) {
      const tr = document.createElement('tr');
      const isSelf = prof.user_key === currentUser?.userKey;
      const roleClass = prof.role === 'admin' ? 'admin' : 'employee';
      const roleLabel = prof.role === 'admin' ? 'Správce' : 'Zaměstnanec';
      const createdDate = prof.created_at ? new Date(prof.created_at).toLocaleDateString('cs-CZ') : '-';

      tr.innerHTML = `
        <td><strong>${escapeHtml(prof.display_name || prof.username)}</strong>${isSelf ? ' <small class="muted">(ty)</small>' : ''}</td>
        <td><code>${escapeHtml(prof.username)}</code></td>
        <td><span class="role-badge ${roleClass}">${roleLabel}</span></td>
        <td>${createdDate}</td>
        <td>
          <div class="table-action-cell">
            <button class="win-btn-standard compact-btn reset-pin-btn" type="button" title="Nastavit nový PIN">
              🔑 Reset PIN
            </button>
            ${!isSelf ? `
              <button class="win-btn-subtle compact-btn toggle-role-btn" type="button" title="Změnit roli">
                ${prof.role === 'admin' ? 'Odebrat admin' : 'Dát admin'}
              </button>
              <button class="win-btn-subtle compact-btn danger-btn delete-user-btn" type="button" title="Smazat uživatele">
                ✕ Smazat
              </button>
            ` : ''}
          </div>
        </td>
      `;

      tr.querySelector('.reset-pin-btn')?.addEventListener('click', () => {
        openAdminResetPinModal(prof);
      });

      tr.querySelector('.toggle-role-btn')?.addEventListener('click', async () => {
        const nextRole = prof.role === 'admin' ? 'employee' : 'admin';
        if (!confirm(`Opravdu změnit roli uživatele ${prof.username} na "${nextRole === 'admin' ? 'Správce' : 'Zaměstnanec'}"?`)) return;
        try {
          await sbFetch('/rest/v1/rpc/admin_change_user_role', {
            method: 'POST',
            body: JSON.stringify({
              p_target_user_key: prof.user_key,
              p_new_role: nextRole
            })
          });
          toast(`Role uživatele ${prof.username} změněna.`, '✓');
          await loadTeamProfiles();
        } catch (err) {
          alert(err.message || 'Změna role se nezdařila.');
        }
      });

      tr.querySelector('.delete-user-btn')?.addEventListener('click', async () => {
        if (!confirm(`OPRAVDU SMAZAT uživatele ${prof.username} (${prof.display_name}) a veškerou jeho docházku? Tuto akci nelze vrátit.`)) return;
        try {
          await sbFetch('/rest/v1/rpc/admin_delete_user', {
            method: 'POST',
            body: JSON.stringify({ p_target_user_key: prof.user_key })
          });
          toast(`Uživatel ${prof.username} byl smazán.`, '✓');
          await loadTeamProfiles();
          await loadTeamSummaries();
        } catch (err) {
          alert(err.message || 'Smazání uživatele selhalo.');
        }
      });

      tbody.appendChild(tr);
    }
  }

  async function loadTeamSummaries() {
    if (!isCloudReady()) return;
    try {
      const now = new Date();
      const monthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const rows = await sbFetch(`/rest/v1/v_monthly_attendance_summary?month=eq.${monthStr}`);
      teamSummaries = rows || [];
      renderTeamSummariesList();
    } catch (err) {
      console.warn('Chyba načtení souhrnů týmu:', err);
    }
  }

  function renderTeamSummariesList() {
    const list = $('#teamSummaryList');
    if (!list) return;
    list.innerHTML = '';

    if (teamSummaries.length === 0) {
      list.innerHTML = `<p class="muted" style="font-size: 13px; margin: 10px 0;">V tomto měsíci zatím nejsou evidována žádná data docházky týmu.</p>`;
      return;
    }

    for (const s of teamSummaries) {
      const item = document.createElement('div');
      item.className = 'team-summary-item';
      const bal = Number(s.total_balance_minutes) || 0;
      const balClass = bal > 0 ? 'positive' : bal < 0 ? 'negative' : 'muted';

      item.innerHTML = `
        <div class="team-user-meta">
          <div class="mini-avatar">${(s.display_name || s.username || '?')[0].toUpperCase()}</div>
          <div>
            <strong>${escapeHtml(s.display_name || s.username)}</strong>
            <small>${s.recorded_days} evidovaných dnů · Dovolená: ${s.vacation_days_used} d.</small>
          </div>
        </div>
        <div class="team-user-stats">
          <strong>${formatDuration(s.total_worked_minutes || 0)}</strong>
          <small class="${balClass}">Saldo: ${formatDuration(bal, true)}</small>
        </div>
      `;
      list.appendChild(item);
    }
  }

  function openAdminResetPinModal(prof) {
    $('#adminResetTargetUserKey').value = prof.user_key;
    $('#adminResetTargetName').textContent = prof.display_name || prof.username;
    $('#adminResetTargetLogin').textContent = prof.username;
    $('#adminResetNewPin').value = '';
    $('#adminResetNewPinConfirm').value = '';
    $('#adminResetPinModal').showModal();
  }

  // ============================================================================
  // EVENT BINDINGS
  // ============================================================================
  function bindEvents() {
    // Navigace
    $$('.nav-item').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
    $$('.m-nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
    $('#dashGoToTimesheetBtn')?.addEventListener('click', () => switchView('timesheet'));

    // Záhlaví a profil
    $('#headerUserBtn')?.addEventListener('click', () => {
      if (currentUser) switchView('settings');
      else $('#loginModal').showModal();
    });
    $('#sidebarAuthBtn')?.addEventListener('click', () => {
      if (currentUser) switchView('settings');
      else $('#loginModal').showModal();
    });
    $('#sidebarUserCard')?.addEventListener('click', (e) => {
      if (e.target.closest('#sidebarAuthBtn')) return;
      if (currentUser) switchView('settings');
      else $('#loginModal').showModal();
    });
    $('#headerSyncBtn')?.addEventListener('click', () => {
      if (isCloudReady()) {
        syncWithSupabase(true).then(() => toast('Synchronizováno', '✓')).catch(err => alert(err.message));
      } else {
        $('#loginModal').showModal();
      }
    });
    $('#sidebarSyncBtn')?.addEventListener('click', () => $('#headerSyncBtn').click());

    // PWA Instalace nápověda
    $('#sidebarHelpBtn')?.addEventListener('click', () => $('#pwaHelpDialog').showModal());
    $('#closePwaHelpBtn')?.addEventListener('click', () => $('#pwaHelpDialog').close());

    // Rychlé akce Dashboard
    $('#editTodayBtn')?.addEventListener('click', () => openDayEditor(todayKey()));
    $('#dashArrivalNowBtn')?.addEventListener('click', () => quickToday((d) => {
      if (!allowsWork(d.type)) d.type = 'work';
      d.start = formatClock();
      d.end = '';
      d.manualBreak = false;
    }, 'Příchod zaznamenán'));

    $('#dashDepartureNowBtn')?.addEventListener('click', () => quickToday((d, hours) => {
      if (!allowsWork(d.type)) d.type = 'work';
      if (!d.start) d.start = hours.start;
      d.end = formatClock();
      d.manualBreak = false;
    }, 'Odchod zaznamenán'));

    $('#shiftEndNowBtn')?.addEventListener('click', () => $('#dashDepartureNowBtn').click());

    $('#dashNormalHoursBtn')?.addEventListener('click', () => quickToday((d, hours) => {
      d.type = 'work';
      d.start = hours.start;
      d.end = hours.end;
      d.manualBreak = false;
      d.breakMinutes = settings.breakMinutes;
    }, 'Běžná pracovní doba zapsána'));

    $('#dashVacationBtn')?.addEventListener('click', () => quickToday((d) => {
      d.type = 'vacation';
      d.start = '';
      d.end = '';
    }, 'Zapsána celodenní dovolená'));

    $('#dashPresetHoBtn')?.addEventListener('click', () => quickToday((d, hours) => {
      d.type = 'homeOffice';
      d.start = hours.start;
      d.end = hours.end;
      d.manualBreak = false;
      d.breakMinutes = settings.breakMinutes;
    }, 'Zapsán Home office'));

    $('#dashPresetDocBtn')?.addEventListener('click', () => quickToday((d) => {
      d.type = 'doctor';
      d.doctorFullDay = true;
      d.start = '';
      d.end = '';
    }, 'Zapsán lékař (celodenní)'));

    $('#dashPresetTripBtn')?.addEventListener('click', () => quickToday((d, hours) => {
      d.type = 'businessTrip';
      d.start = hours.start;
      d.end = hours.end;
      d.manualBreak = false;
      d.breakMinutes = settings.breakMinutes;
    }, 'Zapsána služební cesta'));

    $('#dashPresetCompBtn')?.addEventListener('click', () => quickToday((d) => {
      d.type = 'compTime';
      d.start = '';
      d.end = '';
    }, 'Zapsáno náhradní volno'));

    // Kalendář navigace
    $('#calPrevMonthBtn')?.addEventListener('click', () => { calendarMonth = addMonths(calendarMonth, -1); renderCalendar(); });
    $('#calNextMonthBtn')?.addEventListener('click', () => { calendarMonth = addMonths(calendarMonth, 1); renderCalendar(); });
    $('#calMonthTitleBtn')?.addEventListener('click', () => openMonthPicker('calendar'));
    $('#calFillMissingBtn')?.addEventListener('click', () => fillMissingDaysInMonth(calendarMonth));

    // Timesheet navigace
    $('#tsPrevMonthBtn')?.addEventListener('click', () => { timesheetMonth = addMonths(timesheetMonth, -1); renderTimesheet(); });
    $('#tsNextMonthBtn')?.addEventListener('click', () => { timesheetMonth = addMonths(timesheetMonth, 1); renderTimesheet(); });
    $('#tsMonthTitleBtn')?.addEventListener('click', () => openMonthPicker('timesheet'));
    $('#tsMonthTitle')?.addEventListener('click', () => openMonthPicker('timesheet'));
    $('#tsFillMissingBtn')?.addEventListener('click', () => fillMissingDaysInMonth(timesheetMonth));
    $('#tsExportCsvBtn')?.addEventListener('click', () => exportMonthlyCsv(timesheetMonth));
    $('#tsPrintBtn')?.addEventListener('click', () => window.print());

    // Month Picker Modal
    $('#pickerPrevYearBtn')?.addEventListener('click', () => { pickerSelectedYear--; renderMonthPickerGrid(); });
    $('#pickerNextYearBtn')?.addEventListener('click', () => { pickerSelectedYear++; renderMonthPickerGrid(); });
    $('#closeMonthPickerBtn')?.addEventListener('click', () => $('#monthPickerModal').close());
    $('#pickerCloseFooterBtn')?.addEventListener('click', () => $('#monthPickerModal').close());
    $('#pickerTodayMonthBtn')?.addEventListener('click', () => {
      const now = new Date();
      if (pickerTarget === 'timesheet') {
        timesheetMonth = startOfMonth(now);
        renderTimesheet();
      } else {
        calendarMonth = startOfMonth(now);
        renderCalendar();
      }
      $('#monthPickerModal').close();
    });

    async function updateRegisterModalState() {
      const inviteInput = $('#regInviteCode');
      const banner = $('#registerModeBanner');
      const title = $('#registerModeTitle');
      const desc = $('#registerModeDesc');
      const hint = $('#regInviteHint');

      if (!isSupabaseConfigured()) {
        if (banner) banner.className = 'win-infobar neutral';
        if (title) title.textContent = 'Lokální režim';
        if (desc) desc.textContent = 'Databáze není připojena. Účet bude vytvořen lokálně v tomto prohlížeči.';
        if (inviteInput) inviteInput.required = false;
        return;
      }

      try {
        const rows = await sbFetch('/rest/v1/attendance_profiles?select=user_key&limit=1');
        const hasUsers = rows && rows.length > 0;

        if (!hasUsers) {
          if (banner) banner.className = 'win-infobar success';
          if (title) title.textContent = 'První instalace aplikace (Hlavní správce)';
          if (desc) desc.textContent = 'V databázi dosud není žádný účet. Váš profil bude vytvořen jako hlavní Správce (Admin) bez nutnosti pozvánky.';
          if (inviteInput) {
            inviteInput.required = false;
            inviteInput.value = '';
            inviteInput.placeholder = '(První účet – kód není potřeba)';
          }
          if (hint) hint.textContent = 'Kód pozvánky není vyžadován pro prvního správce.';
        } else {
          if (banner) banner.className = 'win-infobar info';
          if (title) title.textContent = 'Registrace pouze na pozvánku (Invite-Only)';
          if (desc) desc.textContent = 'Pro vytvoření účtu je vyžadován platný kód pozvánky od správce docházky.';
          if (inviteInput) {
            inviteInput.required = true;
            inviteInput.placeholder = 'např. INV-8X2K9M';
          }
          if (hint) hint.textContent = 'Registrace nových uživatelů je uzamčena. Zadej kód pozvánky od správce.';
        }
      } catch (err) {
        console.warn('Nelze ověřit stav registrace:', err);
      }
    }

    // PŘIHLÁŠENÍ & REGISTRACE MODALY
    $('#openLoginModalBtn')?.addEventListener('click', () => $('#loginModal').showModal());
    $('#closeLoginModalBtn')?.addEventListener('click', () => $('#loginModal').close());
    $('#switchToRegisterBtn')?.addEventListener('click', () => {
      $('#loginModal').close();
      $('#registerModal').showModal();
      updateRegisterModalState();
    });

    $('#openRegisterModalBtn')?.addEventListener('click', () => {
      $('#registerModal').showModal();
      updateRegisterModalState();
    });
    $('#closeRegisterModalBtn')?.addEventListener('click', () => $('#registerModal').close());
    $('#switchToLoginBtn')?.addEventListener('click', () => {
      $('#registerModal').close();
      $('#loginModal').showModal();
    });

    $('#openTeamFromSettingsBtn')?.addEventListener('click', () => {
      switchView('team');
    });

    $('#openTeamFromSettingsCardBtn')?.addEventListener('click', () => {
      switchView('team');
    });

    $('#backToSettingsBtn')?.addEventListener('click', () => {
      switchView('settings');
    });

    $('#claimAdminBtn')?.addEventListener('click', async () => {
      if (!isCloudReady()) {
        toast('Musíte být přihlášeni ke cloudové databázi.', '⚠️');
        return;
      }
      try {
        const res = await sbFetch('/rest/v1/rpc/claim_initial_admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        if (res && res.role === 'admin') {
          currentUser.role = 'admin';
          saveCurrentUser(currentUser);
          renderAuthAndSyncUI();
          toast('Role Správce byla úspěšně aktivována!', '✓');
          switchView('team');
        } else {
          toast('V databázi již existuje jiný správce. Požádejte jej o přidělení role.', 'ℹ');
        }
      } catch (err) {
        alert(err.message || 'Nepodařilo se aktivovat roli správce.');
      }
    });

    $('#loginUserForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const rememberMe = $('#loginRememberMe') ? $('#loginRememberMe').checked : true;
        const msg = await performLogin($('#loginUsername').value, $('#loginPin').value, rememberMe);
        $('#loginModal').close();
        renderAll();
        toast(msg, '✓');
      } catch (err) {
        alert(err.message || 'Přihlášení se nezdařilo.');
      }
    });

    // Přihlášení přes biometriku
    $('#loginBiometricBtn')?.addEventListener('click', async () => {
      try {
        const msg = await authenticateWithBiometrics();
        $('#loginModal').close();
        renderAll();
        toast(msg, '✓');
      } catch (err) {
        alert(err.message || 'Biometrické ověření se nezdařilo.');
      }
    });

    // Povolení biometrie v nastavení profilu
    $('#enableBiometricsBtn')?.addEventListener('click', async () => {
      if (!currentUser) return;
      try {
        const confirmed = confirm(`Chcete pro účet "${currentUser.username}" povolit biometrické přihlášení (Windows Hello / Otisk prstu / Face ID)?`);
        if (!confirmed) return;

        const success = await registerBiometricsForCurrentUser();
        if (success) {
          toast('Biometrické přihlašování bylo úspěšně aktivováno pro toto zařízení.', '✓');
          renderAuthAndSyncUI();
        }
      } catch (err) {
        alert(err.message || 'Povolení biometrie selhalo.');
      }
    });

    $('#registerUserForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const msg = await performRegister(
          $('#regUsername').value,
          $('#regDisplayName').value,
          $('#regPin').value,
          $('#regPinConfirm').value,
          $('#regInviteCode')?.value,
          $('#regMergeLocalDays').checked
        );
        $('#registerModal').close();
        renderAll();
        toast(msg, '✓');
      } catch (err) {
        alert(err.message || 'Registrace se nezdařila.');
      }
    });

    $('#openChangePinModalBtn')?.addEventListener('click', () => {
      $('#changePinForm')?.reset();
      $('#changePinModal')?.showModal();
    });
    $('#closeChangePinModalBtn')?.addEventListener('click', () => $('#changePinModal')?.close());
    $('#cancelChangePinBtn')?.addEventListener('click', () => $('#changePinModal')?.close());

    $('#changePinForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const msg = await performChangePin(
          $('#oldPinInput').value,
          $('#newPinInput').value,
          $('#newPinConfirmInput').value
        );
        $('#changePinModal')?.close();
        toast(msg, '✓');
      } catch (err) {
        alert(err.message || 'Změna PINu se nezdařila.');
      }
    });

    // SPRÁVA TÝMU & POZVÁNKY
    $('#openCreateInviteBtn')?.addEventListener('click', () => {
      $('#createInviteForm')?.reset();
      $('#inviteResultArea')?.classList.add('hidden');
      $('#createInviteModal')?.showModal();
    });
    $('#closeCreateInviteModalBtn')?.addEventListener('click', () => $('#createInviteModal')?.close());
    $('#cancelCreateInviteBtn')?.addEventListener('click', () => $('#createInviteModal')?.close());

    $('#createInviteForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isCloudReady()) {
        alert('Pro vytváření pozvánek musí být připojena Supabase databáze.');
        return;
      }
      try {
        const targetRole = $('#inviteRoleSelect')?.value || 'employee';
        const res = await sbFetch('/rest/v1/rpc/admin_create_invite', {
          method: 'POST',
          body: JSON.stringify({ p_target_role: targetRole })
        });

        if (res && res.code) {
          const url = `${window.location.origin}${window.location.pathname}?invite=${res.code}`;
          $('#generatedInviteUrlInput').value = url;
          $('#generatedInviteCodeBadge').textContent = res.code;
          $('#inviteResultArea')?.classList.remove('hidden');

          navigator.clipboard?.writeText(url).then(() => {
            toast('Pozvánka vytvořena a odkaz zkopírován!', '✓');
          }).catch(() => {
            toast('Pozvánka byla úspěšně vygenerována.', '✓');
          });

          await loadTeamInvites();
        }
      } catch (err) {
        alert(err.message || 'Vytvoření pozvánky selhalo.');
      }
    });

    $('#copyGeneratedInviteBtn')?.addEventListener('click', () => {
      const url = $('#generatedInviteUrlInput')?.value;
      if (!url) return;
      navigator.clipboard?.writeText(url).then(() => {
        toast('Odkaz zkopírován do schránky', '✓');
      }).catch(() => {
        prompt('Odkaz pozvánky:', url);
      });
    });

    // Reset PINu zaměstnance
    $('#closeAdminResetPinModalBtn')?.addEventListener('click', () => $('#adminResetPinModal')?.close());
    $('#cancelAdminResetPinBtn')?.addEventListener('click', () => $('#adminResetPinModal')?.close());

    $('#adminResetPinForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUserKey = $('#adminResetTargetUserKey')?.value;
      const targetLogin = $('#adminResetTargetLogin')?.textContent;
      const newPin = $('#adminResetNewPin')?.value;
      const newPinConfirm = $('#adminResetNewPinConfirm')?.value;

      if (!newPin || newPin.length < 4) {
        alert('PIN musí mít alespoň 4 znaky.');
        return;
      }
      if (newPin !== newPinConfirm) {
        alert('Nové PINy se neshodují.');
        return;
      }

      try {
        const newHash = await hashPin(newPin, targetLogin);
        await sbFetch('/rest/v1/rpc/admin_reset_user_pin', {
          method: 'POST',
          body: JSON.stringify({
            p_target_user_key: targetUserKey,
            p_new_pin_hash: newHash
          })
        });
        $('#adminResetPinModal')?.close();
        toast(`PIN pro uživatele ${targetLogin} byl změněn.`, '✓');
      } catch (err) {
        alert(err.message || 'Reset PINu selhal.');
      }
    });

    $('#refreshTeamDataBtn')?.addEventListener('click', async () => {
      await renderTeamView();
      toast('Data týmu byla obnovena', '✓');
    });

    $('#logoutUserBtn')?.addEventListener('click', () => {
      if (!confirm('Odhlásit uživatele z tohoto zařízení?')) return;
      saveCurrentUser(null);
      saveBiometricsCredentials(null);
      setSyncState('local');
      renderAll();
      toast('Uživatel byl odhlášen', 'ℹ️');
    });

    // Nastavení: automatický fond z hodin
    $('#calcTargetAutoBtn')?.addEventListener('click', () => {
      const dur = durationMinutes($('#setWorkStart').value, $('#setWorkEnd').value);
      const brk = clamp(Number($('#setBreakMinutes').value) || 0, 0, 240);
      const net = Math.max(0, dur - brk);
      $('#setDailyTarget').value = minutesToTime(net);
      toast(`Denní fond nastaven na ${formatDuration(net)}`, '✓');
    });

    // Nastavení: víkendový režim
    $('#setWeekendMode')?.addEventListener('change', (e) => {
      const mode = e.target.value;
      let days = [1, 2, 3, 4, 5];
      if (mode === 'saturday') days = [1, 2, 3, 4, 5, 6];
      else if (mode === 'sunday') days = [1, 2, 3, 4, 5, 0];
      else if (mode === 'both') days = [1, 2, 3, 4, 5, 6, 0];
      else if (mode === 'custom') return;
      $$('#weekdaysCheckboxes input[type="checkbox"]').forEach(cb => {
        cb.checked = days.includes(Number(cb.value));
      });
    });

    $$('#weekdaysCheckboxes input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = $$('#weekdaysCheckboxes input[type="checkbox"]:checked').map(el => Number(el.value));
        const sorted = [1, 2, 3, 4, 5, 6, 0].filter(d => checked.includes(d)).join(',');
        let m = 'custom';
        if (sorted === '1,2,3,4,5') m = 'none';
        else if (sorted === '1,2,3,4,5,6') m = 'saturday';
        else if (sorted === '1,2,3,4,5,0') m = 'sunday';
        else if (sorted === '1,2,3,4,5,6,0') m = 'both';
        $('#setWeekendMode').value = m;
      });
    });

    $('#setWeekendCustomHours')?.addEventListener('change', (e) => {
      $('#weekendCustomInputsArea').classList.toggle('hidden', !e.target.checked);
    });

    // Uložení nastavení
    $('#scheduleSettingsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const target = timeToMinutes($('#setDailyTarget').value);
      const weekendTarget = timeToMinutes($('#setWeekendTarget').value);
      const checkedDays = $$('#weekdaysCheckboxes input[type="checkbox"]:checked').map(el => Number(el.value));

      settings = normalizeSettings({
        ...settings,
        id: 'settings',
        workStart: $('#setWorkStart').value,
        workEnd: $('#setWorkEnd').value,
        dailyTargetMinutes: target ?? 510,
        breakMinutes: clamp(Number($('#setBreakMinutes').value) || 0, 0, 240),
        breakAfterMinutes: clamp(Number($('#setBreakAfterMinutes').value) || 0, 0, 1440),
        autoFill: $('#setAutoFill').checked,
        workDays: checkedDays.length > 0 ? checkedDays : [1, 2, 3, 4, 5],
        weekendMode: $('#setWeekendMode').value,
        weekendCustomHours: $('#setWeekendCustomHours').checked,
        weekendStart: $('#setWeekendStart').value || '07:00',
        weekendEnd: $('#setWeekendEnd').value || '15:30',
        weekendTargetMinutes: weekendTarget ?? 480,
        workOnHolidays: $('#setWorkOnHolidays').checked,
        theme: $('#setThemeMode').value
      });

      await saveSettings();
      applyTheme();
      renderAll();
      toast('Nastavení pracovní doby uloženo', '✓');
    });

    $('#setThemeMode')?.addEventListener('change', async (e) => {
      settings.theme = e.target.value;
      applyTheme();
      await saveSettings();
    });

    $('#sidebarThemeToggleBtn')?.addEventListener('click', async () => {
      const cur = document.documentElement.dataset.theme;
      const next = cur === 'dark' ? 'light' : 'dark';
      settings.theme = next;
      $('#setThemeMode').value = next;
      applyTheme();
      await saveSettings();
      toast(`Přepnuto na ${next === 'dark' ? 'tmavý' : 'světlý'} motiv`, '🎨');
    });

    // Ruční Supabase nastavení
    $('#saveManualSbBtn')?.addEventListener('click', async () => {
      const url = $('#setSbUrl').value;
      const key = $('#setSbKey').value;
      saveSupabaseConfigToStorage(url, key);
      try {
        if (!isSupabaseConfigured()) throw new Error('Vyplň URL i klíč');
        await sbFetch('/rest/v1/attendance_profiles?select=user_key&limit=1', { method: 'GET' });
        renderAll();
        toast('Spojení se Supabase je funkční', '✓');
      } catch (err) {
        alert(`Připojení selhalo: ${err.message}`);
      }
    });

    $('#forceSyncCloudBtn')?.addEventListener('click', () => {
      if (!isCloudReady()) {
        $('#loginModal').showModal();
        return;
      }
      syncWithSupabase(true)
        .then(() => toast('Synchronizace dokončena', '✓'))
        .catch(err => alert(`Synchronizace selhala: ${err.message}`));
    });

    // Dialog editace dne
    $('#closeDayDialogBtn')?.addEventListener('click', () => $('#dayEditDialog').close());
    $('#cancelDayDialogBtn')?.addEventListener('click', () => $('#dayEditDialog').close());

    $('#editDayType')?.addEventListener('change', () => { updateDayFormVisibility(); updateDayPreview(); });
    $('#editManualBreakToggle')?.addEventListener('change', () => { updateDayFormVisibility(); updateDayPreview(); });
    $('#editDoctorFullDay')?.addEventListener('change', () => { updateDayFormVisibility(); updateDayPreview(); });

    ['editDayStart', 'editDayEnd', 'editDayBreak', 'editDoctorStart', 'editDoctorEnd', 'editOtherMinutes'].forEach(id => {
      $(`#${id}`)?.addEventListener('input', updateDayPreview);
    });

    $('#editApplyDefaultHoursBtn')?.addEventListener('click', () => {
      const key = $('#editDayDate').value || todayKey();
      const hours = defaultHoursForDate(key);
      $('#editDayStart').value = hours.start;
      $('#editDayEnd').value = hours.end;
      $('#editManualBreakToggle').checked = false;
      $('#editDayBreak').value = settings.breakMinutes;
      updateDayFormVisibility();
      updateDayPreview();
    });

    $('#dayEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const day = formDayFromInputs();
      await saveDay(day);
      $('#dayEditDialog').close();
      toast('Den byl úspěšně uložen', '✓');
    });

    $('#deleteDayRecordBtn')?.addEventListener('click', async () => {
      const key = $('#editDayDate').value;
      if (!confirm('Opravdu smazat záznam pro tento den?')) return;
      await deleteDay(key);
      $('#dayEditDialog').close();
      toast('Záznam byl smazán', '🗑️');
    });

    // Export & Import
    $('#exportJsonBtn')?.addEventListener('click', exportBackup);
    $('#importJsonBtn')?.addEventListener('click', () => $('#jsonImportInput').click());
    $('#jsonImportInput')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importBackup(file);
        toast('Záloha úspěšně importována', '✓');
      } catch (err) {
        alert(err.message || 'Import selhal');
      }
      e.target.value = '';
    });
    $('#resetLocalDbBtn')?.addEventListener('click', resetAll);

    // O aplikaci – nápověda PWA
    $('#aboutPwaHelpBtn')?.addEventListener('click', () => {
      $('#pwaHelpDialog')?.showModal();
    });

    // Zavření modálu klikem na backdrop
    ['dayEditDialog', 'loginModal', 'registerModal', 'pwaHelpDialog', 'monthPickerModal', 'changePinModal', 'createInviteModal', 'adminResetPinModal'].forEach(id => {
      const dlg = $(`#${id}`);
      dlg?.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
      });
    });
  }

  // ============================================================================
  // SPUŠTĚNÍ APLIKACE
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
      // offline
    }
  }

  async function init() {
    try {
      await refreshConfigFromNetwork();
      db = await openDb();
      await loadData();
      bindEvents();
      renderAll();

      // Kontrola pozvánky z URL adresy (?invite=INV-...)
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const inviteCode = urlParams.get('invite');
        if (inviteCode) {
          const invField = $('#regInviteCode');
          if (invField) invField.value = inviteCode.trim().toUpperCase();
          $('#loginModal')?.close();
          $('#registerModal')?.showModal();
          toast(`Pozvánka ${inviteCode} byla načtena`, '✓');
        }
      } catch (err) {
        console.warn('Chyba při čtení URL pozvánky:', err);
      }

      if (isCloudReady()) {
        syncWithSupabase(true).catch(console.warn);
      } else if (isSupabaseConfigured() && !currentUser && !window.location.search.includes('invite=')) {
        $('#loginModal').showModal();
      }

      // Spuštění živých stopek (každou sekundu)
      if (!activeShiftTimerInterval) {
        activeShiftTimerInterval = setInterval(() => {
          updateActiveShiftTimer();
        }, 1000);
      }

      // Service worker pro PWA s auto-update hláškou
      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker?.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                toast('Aplikace byla aktualizována na nejnovější verzi', '✓');
                setTimeout(() => location.reload(), 1000);
              }
            });
          });
        }).catch(console.warn);
      }
    } catch (err) {
      console.error(err);
      alert('Aplikaci se nepodařilo spustit. Zkontroluj, že prohlížeč povoluje úložiště IndexedDB.');
    }
  }

  init();
})();
