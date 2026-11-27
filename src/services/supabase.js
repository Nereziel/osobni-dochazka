/**
 * Same-origin API client.
 *
 * Supabase connection details and the attendance session credential stay behind
 * Cloudflare Pages Functions. Browser JavaScript only talks to /api/supabase.
 */

const LS_REMEMBER_KEY = 'dochazka_remember_login_v1';
const API_BASE = '/api/supabase';

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
    const raw = await response.text();
    try {
      const errJson = JSON.parse(raw);
      detail = errJson?.message || errJson?.error_description || '';
    } catch {
      // A proxy or network failure may return HTML; never expose it as an error.
    }
    const error = new Error(detail || `Chyba API (${response.status})`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
