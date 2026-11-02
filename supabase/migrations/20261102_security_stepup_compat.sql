-- ============================================================================
-- OSOBNI DOCHAZKA - ADMIN STEP-UP COMPATIBILITY (2026-11-02)
-- Keeps the existing two-argument admin reset UI flow while requiring a
-- freshly re-authenticated admin session.
-- ============================================================================

begin;

alter table public.attendance_sessions
  add column if not exists elevated_until timestamptz;

create or replace function public.is_admin_elevated()
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_raw_token text;
  v_token_hash text;
begin
  if not public.is_admin() then
    return false;
  end if;
  v_raw_token := public.current_session_token();
  if v_raw_token = '' then
    return false;
  end if;
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  return exists (
    select 1
    from public.attendance_sessions
    where token_hash = v_token_hash
      and revoked_at is null
      and expires_at > now()
      and elevated_until > now()
  );
end;
$$;

create or replace function public.admin_step_up(p_admin_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor text;
  v_raw_token text;
  v_token_hash text;
  v_until timestamptz := now() + interval '5 minutes';
begin
  v_actor := public.assert_admin_step_up(p_admin_pin);
  v_raw_token := public.current_session_token();
  if v_raw_token = '' then
    raise exception 'Chybí platná session.';
  end if;
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  update public.attendance_sessions
  set elevated_until = v_until,
      last_used_at = now()
  where token_hash = v_token_hash
    and user_key = v_actor
    and revoked_at is null
    and expires_at > now();
  if not found then
    raise exception 'Session není platná.';
  end if;

  perform public.log_attendance_security_event('admin_step_up', v_actor);
  return jsonb_build_object('success', true, 'elevated_until', v_until);
end;
$$;

-- Backward-compatible reset RPC used by the current parent component.
-- It is safe only after admin_step_up() elevated the same bearer session.
create or replace function public.admin_reset_user_pin(
  p_target_user_key text,
  p_new_pin text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor text;
  v_bcrypt text;
begin
  if not public.is_admin_elevated() then
    raise exception 'Pro tuto operaci je nutné znovu ověřit admin PIN.';
  end if;
  v_actor := public.current_session_user_key();
  if p_target_user_key = v_actor then
    raise exception 'Vlastní PIN změň přes funkci Změnit PIN.';
  end if;
  if p_new_pin is null or length(p_new_pin) < 6 then
    raise exception 'PIN/heslo musí mít alespoň 6 znaků.';
  end if;

  v_bcrypt := crypt(p_new_pin, gen_salt('bf', 10));
  update public.attendance_credentials
  set pin_password_hash = v_bcrypt,
      failed_login_count = 0,
      locked_until = null,
      updated_at = now()
  where user_key = p_target_user_key;
  if not found then
    raise exception 'Uživatel nebyl nalezen.';
  end if;

  update public.attendance_sessions
  set revoked_at = now()
  where user_key = p_target_user_key and revoked_at is null;

  perform public.log_attendance_security_event('admin_reset_user_pin', p_target_user_key);
  return true;
end;
$$;

revoke all on function public.is_admin_elevated() from public, anon, authenticated;
revoke all on function public.admin_step_up(text) from public, anon, authenticated;
revoke all on function public.admin_reset_user_pin(text, text) from public, anon, authenticated;

grant execute on function public.admin_step_up(text) to anon, authenticated;
grant execute on function public.admin_reset_user_pin(text, text) to anon, authenticated;

commit;
