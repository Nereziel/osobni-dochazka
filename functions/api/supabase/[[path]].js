const COOKIE_NAME = '__Host-dochazka_session';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUERY_LENGTH = 2048;

const ROUTES = new Map([
  ['POST rest/v1/rpc/login_attendance_user', { name: 'login_attendance_user', requiresAuth: false, issuesToken: true }],
  ['POST rest/v1/rpc/register_user_with_invite', { name: 'register_user_with_invite', requiresAuth: false, issuesToken: true }],
  ['POST rest/v1/rpc/registration_status', { name: 'registration_status', requiresAuth: false, issuesToken: false }],
  ['POST rest/v1/rpc/verify_attendance_session', { name: 'verify_attendance_session', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/logout_attendance_session', { name: 'logout_attendance_session', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/change_attendance_pin', { name: 'change_attendance_pin', requiresAuth: true, issuesToken: true }],
  ['POST rest/v1/rpc/update_own_settings', { name: 'update_own_settings', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/upsert_attendance_day_lww', { name: 'upsert_attendance_day_lww', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_step_up', { name: 'admin_step_up', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_create_invite', { name: 'admin_create_invite', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_list_invites', { name: 'admin_list_invites', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_list_audit_log', { name: 'admin_list_audit_log', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_delete_invite', { name: 'admin_delete_invite', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_change_user_role', { name: 'admin_change_user_role', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_delete_user', { name: 'admin_delete_user', requiresAuth: true, issuesToken: false }],
  ['POST rest/v1/rpc/admin_reset_user_pin', { name: 'admin_reset_user_pin', requiresAuth: true, issuesToken: false }],
  ['GET rest/v1/attendance_profiles', { name: 'attendance_profiles', requiresAuth: true, issuesToken: false }],
  ['GET rest/v1/attendance_days', { name: 'attendance_days', requiresAuth: true, issuesToken: false }],
  ['GET rest/v1/v_monthly_attendance_summary', { name: 'v_monthly_attendance_summary', requiresAuth: true, issuesToken: false }]
]);

// Only the RPC arguments used by the existing app are forwarded. The database
// remains responsible for authorization and validation of business fields.
const RPC_ARGUMENTS = new Map([
  ['login_attendance_user', ['p_username', 'p_pin', 'p_remember']],
  ['register_user_with_invite', ['p_username', 'p_display_name', 'p_pin', 'p_invite_code']],
  ['registration_status', []],
  ['verify_attendance_session', []],
  ['logout_attendance_session', ['p_all_devices']],
  ['change_attendance_pin', ['p_old_pin', 'p_new_pin', 'p_revoke_others']],
  ['update_own_settings', ['p_settings']],
  ['upsert_attendance_day_lww', ['p_day']],
  ['admin_step_up', ['p_admin_pin']],
  ['admin_create_invite', []],
  ['admin_list_invites', []],
  ['admin_list_audit_log', ['p_limit']],
  ['admin_delete_invite', ['p_code']],
  ['admin_change_user_role', ['p_target_user_key', 'p_new_role', 'p_admin_pin']],
  ['admin_delete_user', ['p_target_user_key', 'p_admin_pin']],
  ['admin_reset_user_pin', ['p_target_user_key', 'p_new_pin', 'p_admin_pin']]
]);

const READ_QUERY = new Map([
  ['attendance_profiles', { user_key: /^eq\.user:[a-z0-9._-]+$/i, select: /^\*$/, order: /^created_at\.asc$/ }],
  ['attendance_days', { user_key: /^eq\.user:[a-z0-9._-]+$/i, select: /^\*$/, order: /^date\.asc$/, updated_at: /^gte\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/ }],
  ['v_monthly_attendance_summary', { month: /^eq\.\d{4}-(?:0[1-9]|1[0-2])$/ }]
]);

function validQuery(route, url) {
  if (url.search.length > MAX_QUERY_LENGTH) return false;
  const allowed = READ_QUERY.get(route.name);
  if (!allowed) return url.search === '';
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !Object.hasOwn(allowed, key) || !allowed[key].test(value)) return false;
    seen.add(key);
  }
  if (route.name === 'attendance_days') return seen.has('user_key');
  if (route.name === 'v_monthly_attendance_summary') return seen.has('month');
  return true;
}

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      try {
        const value = decodeURIComponent(rawValue.join('='));
        return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : '';
      } catch {
        return '';
      }
    }
  }
  return '';
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function makeSessionCookie(token, remember, expiresAt) {
  let cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  if (remember && expiresAt) {
    const expiresMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresMs)) {
      const maxAge = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
      cookie += `; Max-Age=${maxAge}; Expires=${new Date(expiresMs).toUTCString()}`;
    }
  }
  return cookie;
}

function rejectCrossOriginMutation(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return false;

  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  const expectedOrigin = new URL(request.url).origin;

  if (fetchSite === 'cross-site') return true;
  return !origin || origin !== expectedOrigin;
}

function classifyRoute(pathParts, method) {
  return ROUTES.get(`${method.toUpperCase()} ${pathParts.join('/')}`) || null;
}

async function readRequestBody(request, route) {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return { text: '' };
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return { status: 413, error: 'body_too_large' };
  }
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return { status: 415, error: 'unsupported_media_type' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { status: 413, error: 'body_too_large' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const payload = JSON.parse(text);
    const allowed = RPC_ARGUMENTS.get(route.name) || [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).some(key => !allowed.includes(key))) {
      return { status: 400, error: 'invalid_body' };
    }
    return { text: JSON.stringify(payload) };
  } catch {
    return { status: 400, error: 'invalid_body' };
  } finally {
    reader.releaseLock();
  }
}

function parseRememberPreference(route, bodyText, request) {
  if (route.name === 'login_attendance_user') {
    try {
      const payload = JSON.parse(bodyText || '{}');
      return payload.p_remember === true;
    } catch {
      return false;
    }
  }

  if (route.name === 'change_attendance_pin') {
    return request.headers.get('X-Remember-Session') === 'true';
  }

  return false;
}

function logoutCookieHeaders(route) {
  return route.name === 'logout_attendance_session'
    ? { 'Set-Cookie': clearSessionCookie() }
    : {};
}

export async function onRequest(context) {
  const { request, env } = context;

  if (rejectCrossOriginMutation(request)) {
    return jsonResponse(403, { error: 'forbidden_origin', message: 'Požadavek z cizího originu byl odmítnut.' });
  }

  const rawPath = context.params.path;
  const pathParts = Array.isArray(rawPath) ? rawPath : String(rawPath || '').split('/').filter(Boolean);
  const route = classifyRoute(pathParts, request.method);
  if (!route) {
    return jsonResponse(404, { error: 'not_found', message: 'API operace není povolena.' });
  }

  const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!supabaseUrl || !publishableKey) {
    return jsonResponse(
      503,
      { error: 'not_configured', message: 'Cloud databáze není nakonfigurována.' },
      logoutCookieHeaders(route)
    );
  }

  const sessionCredential = getCookie(request, COOKIE_NAME);
  if (route.requiresAuth && !sessionCredential) {
    return jsonResponse(401, { error: 'unauthorized', message: 'Přihlášení vypršelo nebo chybí.' }, {
      'Set-Cookie': clearSessionCookie()
    });
  }

  const requestUrl = new URL(request.url);
  if (!validQuery(route, requestUrl)) {
    return jsonResponse(400, { error: 'invalid_query', message: 'Nepovolené parametry požadavku.' });
  }

  const body = await readRequestBody(request, route);
  if (body.status) {
    return jsonResponse(body.status, { error: body.error, message: 'Neplatný nebo příliš velký požadavek.' });
  }
  const bodyText = body.text;
  const upstreamHeaders = new Headers({
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
    Accept: 'application/json'
  });

  if (bodyText) upstreamHeaders.set('Content-Type', 'application/json');
  if (sessionCredential) upstreamHeaders.set('X-Attendance-Session', sessionCredential);

  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) upstreamHeaders.set('X-Real-IP', clientIp);

  const userAgent = request.headers.get('User-Agent');
  if (userAgent) upstreamHeaders.set('User-Agent', userAgent);

  // Do not relay client-controlled PostgREST preferences or range headers.
  const upstreamPath = `/${pathParts.map(part => encodeURIComponent(part)).join('/')}`;
  const upstreamUrl = `${supabaseUrl}${upstreamPath}${requestUrl.search}`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: bodyText || undefined,
      redirect: 'manual'
    });
  } catch {
    return jsonResponse(
      502,
      { error: 'upstream_unavailable', message: 'Cloud databáze není momentálně dostupná.' },
      logoutCookieHeaders(route)
    );
  }

  // The upstream key belongs to the gateway. An upstream 401 is a service
  // failure, not proof that the user's custom attendance session expired.
  if (!upstreamResponse.ok) {
    const status = upstreamResponse.status === 401 || upstreamResponse.status >= 500 || upstreamResponse.status < 400
      ? 502 : upstreamResponse.status;
    const message = status === 429 ? 'Příliš mnoho požadavků. Zkus to později.'
      : status >= 500 ? 'Cloud databáze není momentálně dostupná.'
        : 'Cloud databáze požadavek odmítla.';
    return jsonResponse(status, { error: 'upstream_error', message }, logoutCookieHeaders(route));
  }

  const responseHeaders = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  let responseText;
  try {
    responseText = await upstreamResponse.text();
    if (upstreamResponse.status === 204) return new Response(null, {
      status: 204, headers: { ...Object.fromEntries(responseHeaders), ...logoutCookieHeaders(route) }
    });
    const payload = JSON.parse(responseText);
    if (route.issuesToken) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid auth response');
      const credential = payload.session_token;
      delete payload.session_token;
      if (payload.success === true) {
        if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(credential)) {
          throw new Error('Invalid session credential');
        }
        const remember = parseRememberPreference(route, bodyText, request);
        responseHeaders.set('Set-Cookie', makeSessionCookie(credential, remember, payload.expires_at));
      } else if (payload.success !== false) {
        throw new Error('Invalid auth result');
      }
    }
    responseText = JSON.stringify(payload);
  } catch {
    return jsonResponse(502, { error: 'invalid_upstream_response', message: 'Cloud databáze vrátila neplatnou odpověď.' }, logoutCookieHeaders(route));
  }

  if (route.name === 'logout_attendance_session') {
    responseHeaders.set('Set-Cookie', clearSessionCookie());
  }

  return new Response(responseText, {
    status: upstreamResponse.status,
    headers: responseHeaders
  });
}
