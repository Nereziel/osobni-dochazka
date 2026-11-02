const COOKIE_NAME = '__Host-dochazka_session';

const PUBLIC_RPCS = new Set([
  'login_attendance_user',
  'register_user_with_invite',
  'registration_status'
]);

const AUTH_RPCS = new Set([
  'verify_attendance_session',
  'logout_attendance_session',
  'change_attendance_pin',
  'update_own_settings',
  'upsert_attendance_day_lww',
  'admin_step_up',
  'admin_create_invite',
  'admin_list_invites',
  'admin_list_audit_log',
  'admin_delete_invite',
  'admin_change_user_role',
  'admin_delete_user',
  'admin_reset_user_pin'
]);

const READ_RESOURCES = new Set([
  'attendance_profiles',
  'attendance_days',
  'v_monthly_attendance_summary'
]);

const TOKEN_ISSUING_RPCS = new Set([
  'login_attendance_user',
  'register_user_with_invite',
  'change_attendance_pin'
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
  if (pathParts.length === 4 && pathParts[0] === 'rest' && pathParts[1] === 'v1' && pathParts[2] === 'rpc') {
    const rpc = pathParts[3];
    if (method !== 'POST') return null;
    if (PUBLIC_RPCS.has(rpc)) return { type: 'rpc', name: rpc, requiresAuth: false };
    if (AUTH_RPCS.has(rpc)) return { type: 'rpc', name: rpc, requiresAuth: true };
    return null;
  }

  if (pathParts.length === 3 && pathParts[0] === 'rest' && pathParts[1] === 'v1') {
    const resource = pathParts[2];
    if (method === 'GET' && READ_RESOURCES.has(resource)) {
      return { type: 'resource', name: resource, requiresAuth: true };
    }
  }

  return null;
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

  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const publishableKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !publishableKey) {
    return jsonResponse(503, { error: 'not_configured', message: 'Cloud databáze není nakonfigurována.' });
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
    return jsonResponse(502, { error: 'upstream_unavailable', message: 'Cloud databáze není momentálně dostupná.' });
  }

  const responseHeaders = new Headers({
    'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  let responseText = await upstreamResponse.text();

  if (TOKEN_ISSUING_RPCS.has(route.name) && responseText) {
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
