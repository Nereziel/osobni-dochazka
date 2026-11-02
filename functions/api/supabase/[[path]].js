const COOKIE_NAME = '__Host-dochazka_session';

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
      return decodeURIComponent(rawValue.join('='));
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

async function readRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return '';
  return request.text();
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

  const bodyText = await readRequestBody(request);
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

  const prefer = request.headers.get('Prefer');
  if (prefer) upstreamHeaders.set('Prefer', prefer);

  const requestUrl = new URL(request.url);
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

  const responseHeaders = new Headers({
    'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  let responseText = await upstreamResponse.text();

  if (route.issuesToken && responseText) {
    try {
      const payload = JSON.parse(responseText);
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.session_token) {
        const credential = payload.session_token;
        delete payload.session_token;
        const remember = parseRememberPreference(route, bodyText, request);
        responseHeaders.set('Set-Cookie', makeSessionCookie(credential, remember, payload.expires_at));
        responseText = JSON.stringify(payload);
      }
    } catch {
      // Preserve the upstream response if it is not a JSON object.
    }
  }

  if (route.name === 'logout_attendance_session') {
    responseHeaders.set('Set-Cookie', clearSessionCookie());
  }

  return new Response(responseText, {
    status: upstreamResponse.status,
    headers: responseHeaders
  });
}
