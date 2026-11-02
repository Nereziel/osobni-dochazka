-- Authorization and isolation regression tests.
-- Run after schema_base.sql and all current migrations.
-- Entire test transaction is rolled back.

BEGIN;

DO $$
DECLARE
  v_login jsonb;
  v_admin_token text;
  v_user_a_token text;
  v_user_b_token text;
  v_failed boolean;
BEGIN
  delete from public.attendance_profiles;

  insert into public.attendance_profiles(user_key, username, display_name, role)
  values
    ('user:iso_admin', 'iso_admin', 'Isolation Admin', 'admin'),
    ('user:iso_a', 'iso_a', 'Isolation A', 'employee'),
    ('user:iso_b', 'iso_b', 'Isolation B', 'employee');

  insert into public.attendance_credentials(user_key, pin_password_hash)
  values
    ('user:iso_admin', crypt('admin-isolation-123', gen_salt('bf', 10))),
    ('user:iso_a', crypt('employee-a-123', gen_salt('bf', 10))),
    ('user:iso_b', crypt('employee-b-123', gen_salt('bf', 10)));

  perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.41')::text, true);
  v_login := public.login_attendance_user('iso_a', 'employee-a-123', false);
  v_user_a_token := v_login->>'session_token';
  if v_user_a_token is null then
    raise exception 'SEC-I setup: employee A login failed: %', v_login;
  end if;

  perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.42')::text, true);
  v_login := public.login_attendance_user('iso_b', 'employee-b-123', false);
  v_user_b_token := v_login->>'session_token';
  if v_user_b_token is null then
    raise exception 'SEC-I setup: employee B login failed: %', v_login;
  end if;

  -- Employee A must never write attendance owned by B.
  perform set_config(
    'request.headers',
    json_build_object('x-attendance-session', v_user_a_token, 'x-forwarded-for', '198.51.100.41')::text,
    true
  );
  v_failed := false;
  begin
    perform public.upsert_attendance_day_lww(jsonb_build_object(
      'user_key', 'user:iso_b',
      'date', '2026-11-05',
      'type', 'work',
      'start_time', '08:00',
      'end_time', '09:00',
      'updated_at', now()
    ));
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-I01: employee A wrote attendance for employee B';
  end if;

  -- Employee A must not create invites or change roles even if they know their own PIN.
  v_failed := false;
  begin
    perform public.admin_create_invite();
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-I02: employee called admin_create_invite';
  end if;

  v_failed := false;
  begin
    perform public.admin_change_user_role('user:iso_b', 'admin', 'employee-a-123');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-I02: employee elevated another account to admin';
  end if;

  -- update_own_settings must not permit privilege-field injection through settings_json.
  perform public.update_own_settings(jsonb_build_object(
    'display_name', 'Isolation A Updated',
    'settings_json', jsonb_build_object(
      'theme', 'dark',
      'role', 'admin',
      'username', 'hijacked',
      'pin_password_hash', 'leak'
    )
  ));

  if not exists (
    select 1 from public.attendance_profiles
    where user_key = 'user:iso_a'
      and role = 'employee'
      and username = 'iso_a'
      and not (settings_json ? 'role')
      and not (settings_json ? 'username')
      and not (settings_json ? 'pin_password_hash')
  ) then
    raise exception 'SEC-I03: update_own_settings accepted privileged fields';
  end if;

  -- Admin last-account guards must still hold with step-up authentication.
  perform set_config('request.headers', json_build_object('x-forwarded-for', '198.51.100.43')::text, true);
  v_login := public.login_attendance_user('iso_admin', 'admin-isolation-123', false);
  v_admin_token := v_login->>'session_token';
  if v_admin_token is null then
    raise exception 'SEC-I setup: admin login failed: %', v_login;
  end if;
  perform set_config(
    'request.headers',
    json_build_object('x-attendance-session', v_admin_token, 'x-forwarded-for', '198.51.100.43')::text,
    true
  );

  v_failed := false;
  begin
    perform public.admin_change_user_role('user:iso_admin', 'employee', 'admin-isolation-123');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-I04: last admin was demoted';
  end if;

  v_failed := false;
  begin
    perform public.admin_delete_user('user:iso_admin', 'admin-isolation-123');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'SEC-I04: admin deleted their own account';
  end if;

  -- Resetting B's PIN with valid step-up must revoke B's existing session.
  perform public.admin_reset_user_pin('user:iso_b', 'employee-b-reset-456', 'admin-isolation-123');
  perform set_config(
    'request.headers',
    json_build_object('x-attendance-session', v_user_b_token, 'x-forwarded-for', '198.51.100.42')::text,
    true
  );
  if public.current_session_user_key() <> '' then
    raise exception 'SEC-I05: admin PIN reset left target session active';
  end if;

  raise notice 'Authorization isolation regression suite passed.';
END;
$$;

ROLLBACK;
