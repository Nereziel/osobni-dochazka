import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

const schemaGuard = read('supabase/schema.sql');
const schemaBase = read('supabase/schema_base.sql');
const hardening = read('supabase/migrations/20261102_security_hardening.sql');
const followup = read('supabase/migrations/20261102_security_audit_followup.sql');
const stepupCompat = read('supabase/migrations/20261102_security_stepup_compat.sql');
const authSource = read('src/composables/useAuth.js');
const supabaseClient = read('src/services/supabase.js');
const teamView = read('src/views/TeamView.vue');
const resetPinModal = read('src/components/Admin/AdminResetPinModal.vue');
const headers = read('public/_headers');

describe('Security architecture – database bootstrap', () => {
  it('refuses the historical unsafe one-file schema bootstrap', () => {
    expect(schemaGuard).toContain('Do not run supabase/schema.sql alone');
    expect(schemaBase).toContain('create table if not exists public.attendance_profiles');
  });

  it('requires invite-only registration with a six-character credential', () => {
    expect(hardening).toContain("'requires_invite', true");
    expect(hardening).toContain("'missing_invite'");
    expect(hardening).toContain('length(p_pin) < 6');
    expect(hardening).toContain("values(v_user_key, v_clean_user, coalesce(nullif(trim(p_display_name), ''), v_clean_user), 'employee')");
  });

  it('removes direct Data API SELECT access to invite secrets', () => {
    expect(hardening).toContain('revoke select on public.attendance_invites from public, anon, authenticated;');
    expect(hardening).toContain('public.admin_list_invites()');
  });

  it('recomputes attendance metrics on the server instead of trusting client totals', () => {
    expect(hardening).toContain('public.attendance_compute_day_metrics');
    expect(hardening).toContain("(v_metrics->>'worked_minutes')::integer");
    expect(hardening).toContain("(v_metrics->>'balance_minutes')::integer");
  });
});

describe('Security architecture – sessions and login abuse', () => {
  it('stores only hashed session tokens in the database model', () => {
    expect(schemaBase).toContain('token_hash text not null unique');
    expect(schemaBase).toContain("digest(v_raw_token, 'sha256')");
  });

  it('uses per-IP login throttling rather than attacker-triggerable account lockout', () => {
    expect(followup).toContain('attendance_login_rate_limits');
    expect(followup).toContain('public.consume_login_rate_limit');
    expect(followup).toContain("'rate_limited'");
    expect(followup).toContain('locked_until = null');
  });

  it('keeps persistent browser login opt-in and clears local account data on logout', () => {
    expect(authSource).toContain('async function login(usernameInput, pinInput, rememberMe = false)');
    expect(authSource).toContain('clearUserLocalData');
    expect(authSource).toContain('await clearUserLocalData(priorUser.userKey)');
  });
});

describe('Security architecture – privileged admin actions', () => {
  it('requires a fresh admin PIN for role changes and account deletion', () => {
    expect(followup).toContain('public.assert_admin_step_up(p_admin_pin)');
    expect(followup).toContain('public.admin_change_user_role(\n  p_target_user_key text,\n  p_new_role text,\n  p_admin_pin text');
    expect(followup).toContain('public.admin_delete_user(\n  p_target_user_key text,\n  p_admin_pin text');
  });

  it('forbids using admin reset RPC to bypass verification of the current admin PIN', () => {
    expect(followup).toContain('if p_target_user_key = v_actor then');
    expect(followup).toContain('Vlastní PIN změň přes funkci Změnit PIN');
    expect(stepupCompat).toContain('public.is_admin_elevated()');
    expect(stepupCompat).toContain("interval '5 minutes'");
  });

  it('collects step-up credentials only in password fields, not plaintext prompt()', () => {
    expect(teamView).not.toMatch(/\bprompt\s*\(/);
    expect(teamView).toContain('AdminStepUpModal');
    expect(resetPinModal).toContain('type="password"');
    expect(resetPinModal).toContain('/rest/v1/rpc/admin_step_up');
  });

  it('writes privileged security actions to a non-public audit log', () => {
    expect(followup).toContain('create table if not exists public.attendance_audit_log');
    expect(followup).toContain('revoke all on public.attendance_audit_log from public, anon, authenticated;');
    expect(followup).toContain("'admin_change_user_role'");
    expect(followup).toContain("'admin_delete_user'");
  });
});

describe('Security architecture – API and browser boundary', () => {
  it('keeps the custom session credential out of browser state and request headers', () => {
    expect(authSource).not.toContain('sessionToken');
    expect(authSource).not.toContain('session_token');
    expect(supabaseClient).not.toContain('X-Attendance-Session');
    expect(supabaseClient).not.toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('sends browser data requests only to the same-origin Cloudflare API boundary', () => {
    expect(supabaseClient).toContain('/api/supabase');
    expect(supabaseClient).not.toContain('fetch(`${cfg.url}${path}`');
  });

  it('uses admin RPC rather than direct REST DELETE for invites', () => {
    expect(teamView).toContain('/rest/v1/rpc/admin_delete_invite');
    expect(teamView).not.toMatch(/attendance_invites[^\n]*method:\s*['"]DELETE['"]/);
  });

  it('generates new invite links in a URL fragment', () => {
    expect(teamView).toContain('#invite=');
  });

  it('restricts browser network connections to same-origin', () => {
    expect(headers).toContain("connect-src 'self';");
    expect(headers).not.toContain('supabase.co');
  });
});
