-- Audit-log admin read regression tests.
-- Transaction is rolled back; no test data remains.

BEGIN;

DO $$
DECLARE
  v_login jsonb;
  v_admin_token text;
  v_employee_token text;
  v_count integer;
  v_failed boolean;
BEGIN
  delete from public.attendance_profiles;

  insert into public.attendance_profiles (user_key, username, display_name, role)
  values
    ('user:audit_admin', 'audit_admin', 'Audit Admin', 'admin'),
    ('user:audit_employee', 'audit_employee', 'Audit Employee', 'employee');

  insert into public.attendance_credentials (user_key, pin_password_hash)
  values
    ('user:audit_admin', crypt('audit-admin-123', gen_salt('bf', 10))),
    ('user:audit_employee', crypt('audit-employee-123', gen_salt('bf', 10)));

  perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.40')::text, true);
  v_login := public.login_attendance_user('audit_admin', 'audit-admin-123', false);
  v_admin_token := v_login->>'session_token';

  perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.41')::text, true);
  v_login := public.login_attendance_user('audit_employee', 'audit-employee-123', false);
  v_employee_token := v_login->>'session_token';

  insert into public.attendance_audit_log(actor_user_key, action, target_user_key, details, created_at)
  values
    ('user:audit_admin', 'admin_change_user_role', 'user:audit_employee', '{"from":"employee","to":"admin"}'::jsonb, now() - interval '2 minutes'),
    ('user:audit_admin', 'admin_reset_user_pin', 'user:audit_employee', '{}'::jsonb, now() - interval '1 minute');

  -- Admin can read through the dedicated RPC.
  perform set_config(
    'request.headers',
    json_build_object('x-attendance-session', v_admin_token, 'x-forwarded-for', '198.51.100.40')::text,
    true
  );
  select count(*) into v_count from public.admin_list_audit_log(100);
  if v_count < 2 then
    raise exception 'AUDIT-UI-01: admin audit RPC did not return expected rows: %', v_count;
  end if;

  -- Limit is clamped and respected.
  select count(*) into v_count from public.admin_list_audit_log(1);
  if v_count <> 1 then
    raise exception 'AUDIT-UI-02: audit RPC limit was not respected: %', v_count;
  end if;

  -- Employee cannot read the audit stream.
  perform set_config(
    'request.headers',
    json_build_object('x-attendance-session', v_employee_token, 'x-forwarded-for', '198.51.100.41')::text,
    true
  );
  v_failed := false;
  begin
    perform * from public.admin_list_audit_log(100);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'AUDIT-UI-03: employee could read security audit log';
  end if;

  -- Direct table access remains unavailable to REST roles.
  if has_table_privilege('anon', 'public.attendance_audit_log', 'select')
     or has_table_privilege('authenticated', 'public.attendance_audit_log', 'select') then
    raise exception 'AUDIT-UI-04: audit table became directly readable through Data API roles';
  end if;

  raise notice 'Audit-log admin read regression suite passed.';
END;
$$;

ROLLBACK;
