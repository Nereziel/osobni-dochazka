-- Security audit follow-up regression tests (2026-11-02)
-- These tests describe the required behavior before the follow-up migration.
-- The transaction is rolled back; no test data remains.

BEGIN;

DO $$
DECLARE
  v_login jsonb;
  v_admin_token text;
  v_employee_token text;
  v_result jsonb;
  v_i integer;
  v_failed boolean;
  v_count integer;
BEGIN
  delete from public.attendance_profiles;

  insert into public.attendance_profiles (user_key, username, display_name, role)
  values
    ('user:sec_admin2', 'sec_admin2', 'Security Admin 2', 'admin'),
    ('user:sec_employee2', 'sec_employee2', 'Security Employee 2', 'employee');

  insert into public.attendance_credentials (user_key, pin_password_hash)
  values
    ('user:sec_admin2', crypt('admin-secure-123', gen_salt('bf', 10))),
    ('user:sec_employee2', crypt('employee-secure-123', gen_salt('bf', 10)));

  -- ------------------------------------------------------------------------
  -- SEC-A01: account-wide lockout must not let one IP deny a valid login
  -- from another IP. Repeated attempts from the attacking IP are rate-limited.
  -- ------------------------------------------------------------------------
  perform set_config('request.headers', json_build_object('x-forwarded-for', '203.0.113.10')::text, true);
  for v_i in 1..10 loop
    v_result := public.login_attendance_user('sec_employee2', 'wrong-password', false);
  end loop;

  v_result := public.login_attendance_user('sec_employee2', 'wrong-password', false);
  if v_result->>'error' <> 'rate_limited' then
    raise exception 'SEC-A01: repeated login attempts were not IP/account rate-limited: %', v_result;
  end if;

  perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.20')::text, true);
  v_login := public.login_attendance_user('sec_employee2', 'employee-secure-123', false);
  if coalesce((v_login->>'success')::boolean, false) is not true then
    raise exception 'SEC-A01: valid login from a different IP was blocked by attacker activity: %', v_login;
  end if;
  v_employee_token := v_login->>'session_token';

  -- Admin login for privileged operation tests.
  perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.30')::text, true);
  v_login := public.login_attendance_user('sec_admin2', 'admin-secure-123', false);
  if coalesce((v_login->>'success')::boolean, false) is not true then
    raise exception 'SEC-A setup: admin login failed: %', v_login;
  end if;
  v_admin_token := v_login->>'session_token';
  perform set_config(
    'request.headers',
    json_build_object('x-attendance-session', v_admin_token, 'x-forwarded-for', '198.51.100.30')::text,
    true
  );

  -- ------------------------------------------------------------------------
  -- SEC-A02: critical admin actions require a fresh admin PIN (step-up auth).
  -- ------------------------------------------------------------------------
  v_failed := false;
  begin
    perform public.admin_change_user_role('user:sec_employee2', 'admin', 'wrong-admin-pin');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-A02: role escalation succeeded without valid admin step-up PIN';
  end if;

  perform public.admin_change_user_role('user:sec_employee2', 'admin', 'admin-secure-123');
  if not exists (
    select 1 from public.attendance_profiles
    where user_key = 'user:sec_employee2' and role = 'admin'
  ) then
    raise exception 'SEC-A02: role change failed with valid step-up PIN';
  end if;

  -- Return target to employee for the remaining tests.
  perform public.admin_change_user_role('user:sec_employee2', 'employee', 'admin-secure-123');

  v_failed := false;
  begin
    perform public.admin_reset_user_pin('user:sec_employee2', 'employee-reset-456', 'wrong-admin-pin');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-A02: PIN reset succeeded without valid admin step-up PIN';
  end if;

  -- An admin must change their own PIN through change_attendance_pin(), not
  -- bypass old-PIN verification through the admin reset endpoint.
  v_failed := false;
  begin
    perform public.admin_reset_user_pin('user:sec_admin2', 'self-reset-456', 'admin-secure-123');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-A02: admin could reset their own PIN through privileged reset RPC';
  end if;

  -- ------------------------------------------------------------------------
  -- SEC-A03: security-sensitive admin actions produce an append-only audit log.
  -- ------------------------------------------------------------------------
  select count(*) into v_count
  from public.attendance_audit_log
  where actor_user_key = 'user:sec_admin2'
    and action = 'admin_change_user_role'
    and target_user_key = 'user:sec_employee2';
  if v_count < 2 then
    raise exception 'SEC-A03: expected role-change audit records, found %', v_count;
  end if;

  if has_table_privilege('anon', 'public.attendance_audit_log', 'select')
     or has_table_privilege('authenticated', 'public.attendance_audit_log', 'select') then
    raise exception 'SEC-A03: audit log is directly readable through Data API roles';
  end if;

  -- ------------------------------------------------------------------------
  -- SEC-A04: oversized or nonsensical attendance input is rejected server-side.
  -- ------------------------------------------------------------------------
  perform set_config(
    'request.headers',
    json_build_object('x-attendance-session', v_employee_token, 'x-forwarded-for', '198.51.100.20')::text,
    true
  );

  v_failed := false;
  begin
    perform public.upsert_attendance_day_lww(jsonb_build_object(
      'user_key', 'user:sec_employee2',
      'date', '2026-11-04',
      'type', 'work',
      'start_time', '08:00',
      'end_time', '09:00',
      'note', repeat('X', 2001),
      'updated_at', now()
    ));
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-A04: oversized attendance note was accepted';
  end if;

  v_failed := false;
  begin
    perform public.upsert_attendance_day_lww(jsonb_build_object(
      'user_key', 'user:sec_employee2',
      'date', '2200-01-01',
      'type', 'work',
      'start_time', '08:00',
      'end_time', '09:00',
      'updated_at', now()
    ));
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-A04: out-of-range attendance date was accepted';
  end if;

  raise notice 'Security audit follow-up regression suite passed.';
END;
$$;

ROLLBACK;
