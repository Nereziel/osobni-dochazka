/**
 * Same-origin API client.
 *
 * Supabase credentials and the attendance session credential stay behind
 * Cloudflare Pages Functions. Browser JavaScript only talks to /api/supabase.
 */

const LS_SUPABASE_CONFIG_KEY = 'dochazka_supabase_config_v2';
const LS_REMEMBER_KEY = 'dochazka_remember_login_v1';
const API_BASE = '/api/supabase';

export function getSupabaseConfig() {
  return {
    url: API_BASE,
    anonKey: '',
    isBuiltIn: true
  };
}

export function saveManualSupabaseConfig() {
  // Direct browser-to-Supabase configuration is intentionally retired.
  // Remove any legacy locally saved endpoint/key if this old UI action is reached.
  try {
    localStorage.removeItem(LS_SUPABASE_CONFIG_KEY);
  } catch {
    // ignore storage errors
  }
}

export function isSupabaseConfigured() {
  return true;
}

function isRememberedSession() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LS_REMEMBER_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Calls the Cloudflare Pages Functions boundary using the existing PostgREST path.
 * The HttpOnly cookie is attached by the browser and cannot be read here.
 */
export async function supabaseRequest(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/rest/v1/')) {
    throw new Error('Neplatná API cesta.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Remember-Session': isRememberedSession() ? 'true' : 'false',
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'same-origin',
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
    const error = new Error(detail || `Chyba API (${response.status})`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
