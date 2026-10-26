/**
 * Supabase HTTP REST a RPC klient
 * Připojuje se přímo přes standardní fetch API bez nutnosti těžkých knihoven.
 * Využívá HTTP hlavičku X-Attendance-Session pro bezpečnou autentizaci.
 */

const LS_SUPABASE_CONFIG_KEY = 'dochazka_supabase_config_v2';

export function getSupabaseConfig() {
  const envUrl = import.meta.env?.VITE_SUPABASE_URL;
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  const globalConfig = typeof window !== 'undefined' ? window.DOCHAZKA_CONFIG : null;

  if (envUrl && envKey) {
    return {
      url: envUrl.trim().replace(/\/+$/, ''),
      anonKey: envKey.trim(),
      isBuiltIn: true
    };
  }

  if (globalConfig?.supabaseUrl && globalConfig?.supabaseAnonKey) {
    return {
      url: globalConfig.supabaseUrl.trim().replace(/\/+$/, ''),
      anonKey: globalConfig.supabaseAnonKey.trim(),
      isBuiltIn: true
    };
  }

  try {
    const saved = JSON.parse(localStorage.getItem(LS_SUPABASE_CONFIG_KEY) || 'null');
    if (saved?.url && saved?.anonKey) {
      return {
        url: saved.url.trim().replace(/\/+$/, ''),
        anonKey: saved.anonKey.trim(),
        isBuiltIn: false
      };
    }
  } catch {
    // fallback
  }

  return { url: '', anonKey: '', isBuiltIn: false };
}

export function saveManualSupabaseConfig(url, anonKey) {
  const cleanUrl = (url || '').trim().replace(/\/+$/, '');
  const cleanKey = (anonKey || '').trim();
  if (cleanUrl && cleanKey) {
    localStorage.setItem(LS_SUPABASE_CONFIG_KEY, JSON.stringify({ url: cleanUrl, anonKey: cleanKey }));
  } else {
    localStorage.removeItem(LS_SUPABASE_CONFIG_KEY);
  }
}

export function isSupabaseConfigured() {
  const cfg = getSupabaseConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

/**
 * Zabezpečené volání Supabase REST/RPC API přes session token
 */
export async function supabaseRequest(path, options = {}, authUser = null) {
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error('Supabase databáze není nakonfigurována.');
  }

  let sessionToken = authUser?.sessionToken || null;
  if (!sessionToken && typeof window !== 'undefined') {
    try {
      const stored = JSON.parse(
        localStorage.getItem('dochazka_active_user_v2') ||
        sessionStorage.getItem('dochazka_active_user_v2') ||
        'null'
      );
      sessionToken = stored?.sessionToken || null;
    } catch {
      // ignorujeme chybu parsování
    }
  }

  const headers = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (sessionToken) {
    headers['X-Attendance-Session'] = sessionToken;
  }

  const response = await fetch(`${cfg.url}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson.message || errJson.error_description || errJson.hint || JSON.stringify(errJson);
    } catch {
      detail = await response.text();
    }
    const error = new Error(detail || `Chyba Supabase (${response.status})`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
