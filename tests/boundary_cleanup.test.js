import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { onRequest } from '../functions/api/supabase/[[path]].js';

function read(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

const supabaseClient = read('src/services/supabase.js');
const syncSource = read('src/services/sync.js');
const foregroundSyncSource = read('src/composables/useSync.js');
const authSource = read('src/composables/useAuth.js');
const appSource = read('src/App.vue');
const settingsView = read('src/views/SettingsView.vue');
const envExample = read('.env.example');
const readme = read('README.md');
const viteConfig = read('vite.config.js');
const gatewaySource = read('functions/api/supabase/[[path]].js');

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makeContext(pathParts, {
  method = 'POST',
  body,
  cookie,
  env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test'
  }
} = {}) {
  const headers = new Headers({
    Origin: 'https://dochazka.example',
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': '203.0.113.7'
  });
  if (cookie) headers.set('Cookie', cookie);

  return {
    request: new Request(`https://dochazka.example/api/supabase/${pathParts.join('/')}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    params: { path: pathParts },
    env
  };
}

describe('browser Cloudflare boundary cleanup', () => {
  it('keeps Supabase connection configuration out of browser source', () => {
    expect(supabaseClient).not.toContain('LS_SUPABASE_CONFIG_KEY');
    expect(supabaseClient).not.toContain('getSupabaseConfig');
    expect(supabaseClient).not.toContain('saveManualSupabaseConfig');
    expect(supabaseClient).not.toContain('isSupabaseConfigured');
    expect(syncSource).not.toContain('isSupabaseConfigured');
    expect(foregroundSyncSource).not.toContain('isSupabaseConfigured');
    expect(authSource).not.toContain('isSupabaseConfigured');
    expect(appSource).not.toContain('isSupabaseConfigured');
  });

  it('removes the retired manual Supabase credentials UI', () => {
    expect(settingsView).not.toContain('manualSbUrl');
    expect(settingsView).not.toContain('manualSbKey');
    expect(settingsView).not.toContain('Supabase Project URL');
    expect(settingsView).not.toContain('Supabase Anon Public Key');
    expect(settingsView).not.toContain('GitHub Pages');
    expect(settingsView).toContain('Cloudflare Pages');
  });

  it('documents server-only Supabase runtime bindings', () => {
    expect(envExample).toContain('SUPABASE_URL=');
    expect(envExample).toContain('SUPABASE_PUBLISHABLE_KEY=');
    expect(envExample).not.toContain('VITE_SUPABASE_URL');
    expect(envExample).not.toContain('VITE_SUPABASE_ANON_KEY');
    expect(readme).toContain('SUPABASE_PUBLISHABLE_KEY');
    expect(readme).not.toContain('VITE_SUPABASE_URL');
    expect(readme).not.toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('explicitly excludes API paths from the PWA navigation fallback', () => {
    expect(viteConfig).toContain('navigateFallbackDenylist');
    expect(viteConfig).toContain('/^\\/api\\//');
  });
});

describe('strict Pages Function runtime contract', () => {
  it('uses SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for upstream requests', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'rpc', 'registration_status'],
      { body: {} }
    ));

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toBe('https://project.supabase.co/rest/v1/rpc/registration_status');
    expect(init.headers.get('apikey')).toBe('sb_publishable_test');
  });

  it('does not accept legacy VITE/anon runtime variable names', async () => {
    globalThis.fetch = vi.fn();

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'rpc', 'registration_status'],
      {
        body: {},
        env: {
          VITE_SUPABASE_URL: 'https://legacy.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'legacy-key',
          SUPABASE_ANON_KEY: 'legacy-key'
        }
      }
    ));

    expect(response.status).toBe(503);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses one auditable route registry instead of separate allowlist sets', () => {
    expect(gatewaySource).toContain('ROUTES');
    expect(gatewaySource).not.toContain('PUBLIC_RPCS');
    expect(gatewaySource).not.toContain('AUTH_RPCS');
    expect(gatewaySource).not.toContain('READ_RESOURCES');
  });

  it('still rejects unsupported route/method combinations before upstream fetch', async () => {
    globalThis.fetch = vi.fn();

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'rpc', 'login_attendance_user'],
      { method: 'GET' }
    ));

    expect(response.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('still requires the HttpOnly session for protected reads', async () => {
    globalThis.fetch = vi.fn();

    const response = await onRequest(makeContext(
      ['rest', 'v1', 'attendance_days'],
      { method: 'GET' }
    ));

    expect(response.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
