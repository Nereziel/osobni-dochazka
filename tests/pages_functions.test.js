import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/api/supabase/[[path]].js';

const originalFetch = globalThis.fetch;

function makeContext(pathParts, {
  method = 'POST',
  body,
  cookie,
  origin = 'https://dochazka.example',
  extraHeaders = {}
} = {}) {
  const headers = new Headers({
    Origin: origin,
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': '203.0.113.7',
    'Content-Type': 'application/json',
    ...extraHeaders
  });
  if (cookie) headers.set('Cookie', cookie);

  const request = new Request(
    `https://dochazka.example/api/supabase/${pathParts.join('/')}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  );

  return {
    request,
    params: { path: pathParts },
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key'
    }
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Cloudflare Pages session gateway', () => {
  it('moves a login credential into an HttpOnly cookie and strips it from JSON', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      session_token: 'raw-secret-token',
      user_key: 'user:jana',
      username: 'jana',
      display_name: 'Jana',
      role: 'employee',
      expires_at: '2099-01-01T00:00:00Z'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'rpc', 'login_attendance_user'],
      {
        body: { p_username: 'jana', p_pin: '123456', p_remember: true }
      }
    ));

    const payload = await response.json();
    expect(payload).not.toHaveProperty('session_token');
    expect(payload.user_key).toBe('user:jana');
    expect(response.headers.get('Set-Cookie')).toContain('__Host-dochazka_session=raw-secret-token');
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('SameSite=Strict');

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.get('X-Real-IP')).toBe('203.0.113.7');
  });

  it('injects the cookie credential only on the server-side upstream request', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'rpc', 'verify_attendance_session'],
      { cookie: '__Host-dochazka_session=server-only-token' }
    ));

    expect(response.status).toBe(200);
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.get('X-Attendance-Session')).toBe('server-only-token');
  });

  it('rejects a cross-origin mutation before calling Supabase', async () => {
    globalThis.fetch = vi.fn();

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'rpc', 'login_attendance_user'],
      {
        origin: 'https://evil.example',
        body: { p_username: 'jana', p_pin: '123456' }
      }
    ));

    expect(response.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a malformed cookie without throwing or contacting upstream', async () => {
    globalThis.fetch = vi.fn();
    const res = await onRequest(makeContext(['rest', 'v1', 'rpc', 'verify_attendance_session'], {
      cookie: '__Host-dochazka_session=%ZZ'
    }));
    expect(res.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ p_username: 'a', p_pin: 'x'.repeat(65536) }, {}, 413],
    [{ p_username: 'a' }, { 'Content-Length': '70000' }, 413],
    [{ p_username: 'a' }, { 'Content-Type': 'text/plain' }, 415],
    [[1, 2], {}, 400],
    [{ p_username: 'a', unexpected: true }, {}, 400]
  ])('rejects invalid request bodies before forwarding', async (body, extraHeaders, status) => {
    globalThis.fetch = vi.fn();
    const res = await onRequest(makeContext(['rest', 'v1', 'rpc', 'login_attendance_user'], { body, extraHeaders }));
    expect(res.status).toBe(status);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('restricts read queries to the supported filters and ignores Prefer', async () => {
    globalThis.fetch = vi.fn(async () => new Response('[]'));
    const context = makeContext(['rest', 'v1', 'attendance_days'], { method: 'GET', cookie: '__Host-dochazka_session=token' });
    const url = context.request.url + '?user_key=eq.user:jana&select=*&order=date.asc&updated_at=gte.2026-11-27T07:00:00.000Z';
    const request = new Request(url, { headers: { Cookie: '__Host-dochazka_session=token', Prefer: 'count=exact' } });
    expect((await onRequest({ ...context, request })).status).toBe(200);
    expect(globalThis.fetch.mock.calls[0][1].headers.has('Prefer')).toBe(false);
    const rejected = new Request(url + '&select=*', { headers: request.headers });
    expect((await onRequest({ ...context, request: rejected })).status).toBe(400);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 500, 503])('does not leak upstream error detail or invalidate a session on upstream HTTP %i', async (status) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'internal database detail' }), { status }));
    const res = await onRequest(makeContext(['rest', 'v1', 'rpc', 'verify_attendance_session'], {
      cookie: '__Host-dochazka_session=token'
    }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('internal database detail');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('fails closed when the login response has an unexpected shape', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([{ session_token: 'raw-secret-token' }])));
    const res = await onRequest(makeContext(['rest', 'v1', 'rpc', 'login_attendance_user'], {
      body: { p_username: 'jana', p_pin: '123456' }
    }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('raw-secret-token');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('does not send settings for a different account using a shared cookie', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, user_key: 'user:other' })));
    const res = await onRequest(makeContext(['rest', 'v1', 'rpc', 'update_own_settings'], {
      cookie: '__Host-dochazka_session=token',
      body: { p_settings: { user_key: 'user:jana', work_start: '07:00' } }
    }));
    expect(res.status).toBe(409);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toContain('verify_attendance_session');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('forwards settings only after verifying the same captured credential', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, user_key: 'user:jana' })));
    const res = await onRequest(makeContext(['rest', 'v1', 'rpc', 'update_own_settings'], {
      cookie: '__Host-dochazka_session=token',
      body: { p_settings: { user_key: 'user:jana', work_start: '07:00' } }
    }));
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[1][0]).toContain('update_own_settings');
    expect(globalThis.fetch.mock.calls.map(([, init]) => init.headers.get('X-Attendance-Session'))).toEqual(['token', 'token']);
  });

  it('clears the browser cookie even when upstream logout is unavailable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network unavailable');
    });

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'rpc', 'logout_attendance_session'],
      { cookie: '__Host-dochazka_session=server-only-token', body: { p_all_devices: false } }
    ));

    expect(response.status).toBe(502);
    expect(response.headers.get('Set-Cookie')).toContain('__Host-dochazka_session=;');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
