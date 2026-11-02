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
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'publishable-test-key'
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
