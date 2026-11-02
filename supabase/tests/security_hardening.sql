-- Security hardening regression tests (2026-11-02)
-- Run after supabase/schema.sql and the matching hardening migration.
-- The transaction is rolled back; no test data remains.

BEGIN;

DO $$
DECLARE
  v_has_priv boolean;
  v_status jsonb;
  v_reg jsonb;
  v_login jsonb;
  v_admin_token text;
  v_employee_token text;
  v_rotated_token text;
  v_invite jsonb;
  v_invite_code text;
  v_row public.attendance_days%rowtype;
BEGIN
  -- Work only with synthetic data inside this transaction.
  delete from public.attendance_profiles;

  -- 1) Invite table must not be directly readable by REST roles.
  select has_table_privilege('anon', 'public.attendance_invites', 'select') into v_has_priv;
  if v_has_priv then
    raise exception 'SEC-H01: anon still has direct SELECT on attendance_invites';
  end if;
  select has_table_privilege('authenticated', 'public.attendance_invites', 'select') into v_has_priv;
  if v_has_priv then
    raise exception 'SEC-H01: authenticated still has direct SELECT on attendance_invites';
  end if;

  -- 2) Empty database must not expose a public first-admin bootstrap.
  v_status := public.registration_status();
  if coalesce((v_status->>'registration_enabled')::boolean, true) is not false
     or coalesce((v_status->>'requires_invite')::boolean, false) is not true then
    raise exception 'SEC-H02: empty database still advertises public bootstrap registration: %', v_status;
  end if;

  v_reg := public.register_user_with_invite('takeover', 'Takeover', '123456', '');
  if coalesce((v_reg->>'success')::boolean, true) is not false then
    raise exception 'SEC-H02: registration without invite succeeded in an empty database: %', v_reg;
  end if;

  -- Seed an admin as an operator would do out-of-band.
  insert into public.attendance_profiles (user_key, username, display_name, role)
  values ('user:sec_admin', 'sec_admin', 'Security Admin', 'admin');
  insert into public.attendance_credentials (user_key, pin_password_hash)
  values ('user:sec_admin', crypt('admin-secure-123', gen_salt('bf', 10)));

  v_login := public.login_attendance_user('sec_admin', 'admin-secure-123', true);
  v_admin_token := v_login->>'session_token';
  if v_admin_token is null then
    raise exception 'SEC-H setup: admin login failed: %', v_login;
  end if;
  perform set_config('request.headers', json_build_object('x-attendance-session', v_admin_token)::text, true);

  -- 3) New PIN/passwords shorter than 6 characters must be rejected.
  v_invite := public.admin_create_invite();
  v_invite_code := v_invite->>'code';
  v_reg := public.register_user_with_invite('shortpin', 'Short PIN', '1234', v_invite_code);
  if coalesce((v_reg->>'success')::boolean, true) is not false
     or v_reg->>'error' <> 'pin_too_short' then
    raise exception 'SEC-H03: 4-character PIN was accepted: %', v_reg;
  end if;

  -- Create a normal employee with a compliant credential.
  perform set_config('request.headers', json_build_object('x-attendance-session', v_admin_token)::text, true);
  v_invite := public.admin_create_invite();
  v_invite_code := v_invite->>'code';
  v_reg := public.register_user_with_invite('sec_employee', 'Security Employee', '123456', v_invite_code);
  if coalesce((v_reg->>'success')::boolean, false) is not true then
    raise exception 'SEC-H setup: employee registration failed: %', v_reg;
  end if;
  v_employee_token := v_reg->>'session_token';

  -- 4) Changing PIN must rotate the current bearer token as well.
  perform set_config('request.headers', json_build_object('x-attendance-session', v_employee_token)::text, true);
  v_reg := public.change_attendance_pin('123456', '654321', true);
  v_rotated_token := v_reg->>'session_token';
  if coalesce((v_reg->>'success')::boolean, false) is not true or v_rotated_token is null then
    raise exception 'SEC-H04: PIN change did not return a replacement session token: %', v_reg;
  end if;

  perform set_config('request.headers', json_build_object('x-attendance-session', v_employee_token)::text, true);
  if public.current_session_user_key() <> '' then
    raise exception 'SEC-H04: pre-change bearer token remained valid';
  end if;
  perform set_config('request.headers', json_build_object('x-attendance-session', v_rotated_token)::text, true);
  if public.current_session_user_key() <> 'user:sec_employee' then
    raise exception 'SEC-H04: replacement bearer token is not valid';
  end if;

  -- 5) Client supplied derived metrics must be ignored and recomputed server-side.
  perform public.upsert_attendance_day_lww(jsonb_build_object(
    'user_key', 'user:sec_employee',
    'date', '2026-11-03',
    'type', 'work',
    'start_time', '08:00',
    'end_time', '09:00',
    'manual_break', false,
    'break_minutes', 999,
    'worked_minutes', 999999,
    'credited_minutes', 999999,
    'target_minutes', 999999,
    'balance_minutes', 999999,
    'updated_at', now()
  ));

  select * into v_row
  from public.attendance_days
  where user_key = 'user:sec_employee' and date = '2026-11-03';

  -- 2026-11-03 is Tuesday, target=480; one hour presence => worked=60, no auto break.
  if v_row.worked_minutes <> 60
     or v_row.credited_minutes <> 0
     or v_row.target_minutes <> 480
     or v_row.balance_minutes <> -420
     or v_row.break_minutes <> 0 then
    raise exception 'SEC-H05: server trusted client metrics instead of recomputing: worked %, credited %, target %, balance %, break %',
      v_row.worked_minutes, v_row.credited_minutes, v_row.target_minutes, v_row.balance_minutes, v_row.break_minutes;
  end if;

  raise notice 'Security hardening regression suite passed.';
END;
$$;

ROLLBACK;
