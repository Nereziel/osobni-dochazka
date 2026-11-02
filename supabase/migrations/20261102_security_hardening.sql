-- ============================================================================
-- OSOBNI DOCHAZKA - SECURITY HARDENING MIGRATION (2026-11-02)
-- Safe for an existing database. Idempotent where PostgreSQL permits it.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Server-side attendance calculations
-- --------------------------------------------------------------------------
create or replace function public.attendance_time_to_minutes(p_time text)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_h integer;
  v_m integer;
begin
  if p_time is null or p_time !~ '^[0-9]{2}:[0-9]{2}$' then
    return null;
  end if;
  v_h := split_part(p_time, ':', 1)::integer;
  v_m := split_part(p_time, ':', 2)::integer;
  if v_h not between 0 and 23 or v_m not between 0 and 59 then
    return null;
  end if;
  return v_h * 60 + v_m;
end;
$$;

create or replace function public.attendance_duration_minutes(p_start text, p_end text)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_s integer := public.attendance_time_to_minutes(p_start);
  v_e integer := public.attendance_time_to_minutes(p_end);
begin
  if v_s is null or v_e is null then
    return 0;
  end if;
  if v_e >= v_s then
    return v_e - v_s;
  end if;
  return (1440 - v_s) + v_e;
end;
$$;

create or replace function public.attendance_overlap_minutes(
  p_start_a text,
  p_end_a text,
  p_start_b text,
  p_end_b text
)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  a_s integer := public.attendance_time_to_minutes(p_start_a);
  a_e integer := public.attendance_time_to_minutes(p_end_a);
  b_s integer := public.attendance_time_to_minutes(p_start_b);
  b_e integer := public.attendance_time_to_minutes(p_end_b);
  total integer := 0;
  a1s integer; a1e integer; a2s integer; a2e integer;
  b1s integer; b1e integer; b2s integer; b2e integer;
begin
  if a_s is null or a_e is null or b_s is null or b_e is null or a_s = a_e or b_s = b_e then
    return 0;
  end if;

  if a_e > a_s then
    a1s := a_s; a1e := a_e; a2s := null; a2e := null;
  else
    a1s := a_s; a1e := 1440; a2s := 0; a2e := a_e;
  end if;

  if b_e > b_s then
    b1s := b_s; b1e := b_e; b2s := null; b2e := null;
  else
    b1s := b_s; b1e := 1440; b2s := 0; b2e := b_e;
  end if;

  total := total + greatest(0, least(a1e, b1e) - greatest(a1s, b1s));
  if a2s is not null then
    total := total + greatest(0, least(a2e, b1e) - greatest(a2s, b1s));
  end if;
  if b2s is not null then
    total := total + greatest(0, least(a1e, b2e) - greatest(a1s, b2s));
  end if;
  if a2s is not null and b2s is not null then
    total := total + greatest(0, least(a2e, b2e) - greatest(a2s, b2s));
  end if;
  return total;
end;
$$;

create or replace function public.attendance_is_czech_holiday(p_date date)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  y integer := extract(year from p_date)::integer;
  a integer; b integer; c integer; d integer; e integer; f integer; g integer;
  h integer; i integer; k integer; l integer; m integer;
  easter_month integer; easter_day integer;
  easter_sunday date;
begin
  if to_char(p_date, 'MM-DD') in (
    '01-01','05-01','05-08','07-05','07-06','09-28','10-28','11-17','12-24','12-25','12-26'
  ) then
    return true;
  end if;

  a := y % 19;
  b := y / 100;
  c := y % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  easter_month := (h + l - 7 * m + 114) / 31;
  easter_day := ((h + l - 7 * m + 114) % 31) + 1;
  easter_sunday := make_date(y, easter_month, easter_day);

  return p_date = easter_sunday - 2 or p_date = easter_sunday + 1;
end;
$$;

create or replace function public.attendance_compute_day_metrics(
  p_day jsonb,
  p_user_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  p public.attendance_profiles%rowtype;
  v_date date;
  v_type text;
  v_target integer := 0;
  v_presence integer := 0;
  v_break integer := 0;
  v_worked integer := 0;
  v_credited integer := 0;
  v_balance integer := 0;
  v_overlap integer := 0;
  v_dow integer;
  v_scheduled boolean := false;
  v_allows_work boolean := false;
  v_manual_break boolean := false;
  v_doctor_full boolean := false;
  v_other integer := 0;
begin
  select * into p
  from public.attendance_profiles
  where user_key = p_user_key;
  if not found then
    raise exception 'Uživatelský profil nebyl nalezen.';
  end if;

  v_date := (p_day->>'date')::date;
  v_type := coalesce(p_day->>'type', 'work');
  v_dow := extract(dow from v_date)::integer;

  v_scheduled := v_dow = any(p.work_days)
    and (p.work_on_holidays or not public.attendance_is_czech_holiday(v_date));

  if v_type <> 'holiday' and v_scheduled then
    if v_dow in (0, 6) and p.weekend_custom_hours then
      v_target := p.weekend_target_minutes;
    else
      v_target := p.daily_target_minutes;
    end if;
  end if;

  v_allows_work := v_type in ('work','homeOffice','businessTrip','halfVacation','doctor','other');
  v_manual_break := coalesce((p_day->>'manual_break')::boolean, false);
  v_doctor_full := coalesce((p_day->>'doctor_full_day')::boolean, false);
  v_presence := public.attendance_duration_minutes(p_day->>'start_time', p_day->>'end_time');

  if v_allows_work and v_presence > 0 then
    if v_manual_break then
      v_break := least(v_presence, greatest(0, coalesce((p_day->>'break_minutes')::integer, 0)));
    elsif v_presence >= p.break_after_minutes then
      v_break := least(v_presence, greatest(0, p.break_minutes));
    end if;
  end if;

  if v_allows_work and not (v_type = 'doctor' and v_doctor_full) then
    if v_type = 'doctor' and coalesce(p_day->>'doctor_start','') <> '' and coalesce(p_day->>'doctor_end','') <> '' then
      v_overlap := public.attendance_overlap_minutes(
        p_day->>'start_time', p_day->>'end_time', p_day->>'doctor_start', p_day->>'doctor_end'
      );
    end if;
    v_worked := greatest(0, v_presence - v_break - v_overlap);
  end if;

  if v_target > 0 then
    case v_type
      when 'vacation' then v_credited := v_target;
      when 'halfVacation' then v_credited := round(v_target::numeric / 2)::integer;
      when 'sick' then v_credited := v_target;
      when 'compTime' then v_credited := v_target;
      when 'doctor' then
        if v_doctor_full then
          v_credited := v_target;
        else
          v_credited := least(v_target, public.attendance_duration_minutes(p_day->>'doctor_start', p_day->>'doctor_end'));
        end if;
      when 'other' then
        v_other := greatest(0, coalesce((p_day->>'other_minutes')::integer, 0));
        v_credited := least(v_target, v_other);
      else v_credited := 0;
    end case;
  end if;

  v_balance := v_worked + v_credited - v_target;

  return jsonb_build_object(
    'break_minutes', v_break,
    'worked_minutes', v_worked,
    'credited_minutes', v_credited,
    'target_minutes', v_target,
    'balance_minutes', v_balance
  );
end;
$$;

-- Internal helpers are not client API.
revoke all on function public.attendance_time_to_minutes(text) from public, anon, authenticated;
revoke all on function public.attendance_duration_minutes(text, text) from public, anon, authenticated;
revoke all on function public.attendance_overlap_minutes(text, text, text, text) from public, anon, authenticated;
revoke all on function public.attendance_is_czech_holiday(date) from public, anon, authenticated;
revoke all on function public.attendance_compute_day_metrics(jsonb, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. Registration is always invite-only. No public first-admin takeover path.
-- --------------------------------------------------------------------------
create or replace function public.registration_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_has_profiles boolean;
begin
  select exists(select 1 from public.attendance_profiles) into v_has_profiles;
  return jsonb_build_object(
    'registration_enabled', coalesce(v_has_profiles, false),
    'requires_invite', true
  );
end;
$$;

create or replace function public.register_user_with_invite(
  p_username text,
  p_display_name text,
  p_pin text,
  p_invite_code text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_clean_user text;
  v_user_key text;
  v_invite public.attendance_invites%rowtype;
  v_bcrypt text;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('attendance_registration_lock'));

  v_clean_user := lower(trim(regexp_replace(coalesce(p_username, ''), '[^a-zA-Z0-9._-]', '', 'g')));
  if length(v_clean_user) < 3 then
    return jsonb_build_object('success', false, 'error', 'invalid_username', 'message', 'Uživatelské jméno musí mít alespoň 3 znaky.');
  end if;
  if p_pin is null or length(p_pin) < 6 then
    return jsonb_build_object('success', false, 'error', 'pin_too_short', 'message', 'PIN/heslo musí mít alespoň 6 znaků.');
  end if;
  if coalesce(trim(p_invite_code), '') = '' then
    return jsonb_build_object('success', false, 'error', 'missing_invite', 'message', 'Registrace vyžaduje platný kód pozvánky.');
  end if;

  select * into v_invite
  from public.attendance_invites
  where upper(code) = upper(trim(p_invite_code))
  for update;

  if not found or v_invite.is_used or (v_invite.expires_at is not null and v_invite.expires_at < now()) then
    return jsonb_build_object('success', false, 'error', 'invalid_invite', 'message', 'Kód pozvánky neexistuje, byl použit nebo vypršel.');
  end if;

  v_user_key := 'user:' || v_clean_user;
  if exists(select 1 from public.attendance_profiles where user_key = v_user_key) then
    return jsonb_build_object('success', false, 'error', 'username_taken', 'message', 'Uživatelské jméno je již obsazeno.');
  end if;

  v_bcrypt := crypt(p_pin, gen_salt('bf', 10));

  insert into public.attendance_profiles(user_key, username, display_name, role)
  values(v_user_key, v_clean_user, coalesce(nullif(trim(p_display_name), ''), v_clean_user), 'employee');

  insert into public.attendance_credentials(user_key, pin_password_hash, failed_login_count, locked_until)
  values(v_user_key, v_bcrypt, 0, null);

  update public.attendance_invites
  set is_used = true, used_by = v_user_key, used_at = now()
  where code = v_invite.code;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '30 days';

  insert into public.attendance_sessions(user_key, token_hash, expires_at, created_at, last_used_at, user_agent)
  values(v_user_key, v_token_hash, v_expires_at, now(), now(), public.current_client_user_agent());

  return jsonb_build_object(
    'success', true,
    'session_token', v_raw_token,
    'user_key', v_user_key,
    'username', v_clean_user,
    'display_name', coalesce(nullif(trim(p_display_name), ''), v_clean_user),
    'role', 'employee',
    'expires_at', v_expires_at,
    'message', 'Registrace proběhla úspěšně.'
  );
end;
$$;

-- --------------------------------------------------------------------------
-- 3. PIN hardening and current-session rotation
-- Existing 4-character PINs can still log in; only new/reset PINs require 6+.
-- --------------------------------------------------------------------------
create or replace function public.change_attendance_pin(
  p_old_pin text,
  p_new_pin text,
  p_revoke_others boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_key text;
  v_raw_token text;
  v_current_token_hash text;
  v_current_expires timestamptz;
  v_cred public.attendance_credentials%rowtype;
  v_old_valid boolean := false;
  v_new_bcrypt text;
  v_new_raw_token text;
  v_new_token_hash text;
begin
  v_user_key := public.current_session_user_key();
  if v_user_key = '' then
    return jsonb_build_object('success', false, 'error', 'unauthorized', 'message', 'Uživatel není přihlášen.');
  end if;
  if p_old_pin is null or length(p_old_pin) < 1 or p_new_pin is null or length(p_new_pin) < 6 then
    return jsonb_build_object('success', false, 'error', 'invalid_pin', 'message', 'Nový PIN/heslo musí mít alespoň 6 znaků.');
  end if;

  v_raw_token := public.current_session_token();
  v_current_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  select expires_at into v_current_expires
  from public.attendance_sessions
  where token_hash = v_current_token_hash and user_key = v_user_key and revoked_at is null
  for update;

  select * into v_cred
  from public.attendance_credentials
  where user_key = v_user_key
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found', 'message', 'Uživatel nebyl nalezen.');
  end if;

  v_old_valid := coalesce(crypt(p_old_pin, v_cred.pin_password_hash) = v_cred.pin_password_hash, false);
  if not v_old_valid then
    return jsonb_build_object('success', false, 'error', 'invalid_old_pin', 'message', 'Původní PIN není správný.');
  end if;

  v_new_bcrypt := crypt(p_new_pin, gen_salt('bf', 10));
  update public.attendance_credentials
  set pin_password_hash = v_new_bcrypt, failed_login_count = 0, locked_until = null, updated_at = now()
  where user_key = v_user_key;

  -- Always revoke every old bearer token, including the current one.
  update public.attendance_sessions
  set revoked_at = now()
  where user_key = v_user_key and revoked_at is null;

  v_new_raw_token := encode(gen_random_bytes(32), 'hex');
  v_new_token_hash := encode(digest(v_new_raw_token, 'sha256'), 'hex');
  v_current_expires := greatest(coalesce(v_current_expires, now() + interval '1 day'), now() + interval '1 hour');

  insert into public.attendance_sessions(user_key, token_hash, expires_at, created_at, last_used_at, user_agent)
  values(v_user_key, v_new_token_hash, v_current_expires, now(), now(), public.current_client_user_agent());

  return jsonb_build_object(
    'success', true,
    'session_token', v_new_raw_token,
    'expires_at', v_current_expires,
    'message', 'PIN byl úspěšně změněn.'
  );
end;
$$;

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
  v_bcrypt text;
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může resetovat PIN.';
  end if;
  if p_new_pin is null or length(p_new_pin) < 6 then
    raise exception 'PIN/heslo musí mít alespoň 6 znaků.';
  end if;

  v_bcrypt := crypt(p_new_pin, gen_salt('bf', 10));
  update public.attendance_credentials
  set pin_password_hash = v_bcrypt, failed_login_count = 0, locked_until = null, updated_at = now()
  where user_key = p_target_user_key;
  if not found then
    raise exception 'Uživatel nebyl nalezen.';
  end if;

  update public.attendance_sessions
  set revoked_at = now()
  where user_key = p_target_user_key and revoked_at is null;
  return true;
end;
$$;

-- --------------------------------------------------------------------------
-- 4. Admin-only invite listing; no direct Data API SELECT on invite secrets.
-- --------------------------------------------------------------------------
drop function if exists public.admin_list_invites();
create function public.admin_list_invites()
returns table(
  code text,
  created_by text,
  target_role text,
  is_used boolean,
  used_by text,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může číst pozvánky.';
  end if;
  return query
  select i.code, i.created_by, i.target_role, i.is_used, i.used_by, i.used_at, i.expires_at, i.created_at
  from public.attendance_invites i
  order by i.created_at desc;
end;
$$;

revoke select on public.attendance_invites from public, anon, authenticated;
revoke all on function public.admin_list_invites() from public, anon, authenticated;
grant execute on function public.admin_list_invites() to anon, authenticated;

-- --------------------------------------------------------------------------
-- 5. Replace LWW RPC: derived metrics are always server-computed.
-- --------------------------------------------------------------------------
create or replace function public.upsert_attendance_day_lww(p_day jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller_user_key text;
  v_target_user_key text;
  v_date date;
  v_incoming_updated_at timestamptz;
  v_incoming_deleted_at timestamptz;
  v_metrics jsonb;
  v_result_row public.attendance_days%rowtype;
  v_existing_server public.attendance_days%rowtype;
begin
  v_caller_user_key := public.current_session_user_key();
  if coalesce(v_caller_user_key, '') = '' then
    raise exception 'Neautorizovaný přístup: Neplatná nebo expirovaná session.';
  end if;

  v_target_user_key := p_day->>'user_key';
  if v_target_user_key is null or (v_target_user_key <> v_caller_user_key and not public.is_admin()) then
    raise exception 'Přístup odepřen: Nelze upravovat data jiného uživatele.';
  end if;

  v_date := (p_day->>'date')::date;
  if v_date is null then
    raise exception 'Chybí povinný atribut date.';
  end if;

  v_incoming_updated_at := least(coalesce((p_day->>'updated_at')::timestamptz, now()), now());
  if p_day->>'deleted_at' is not null then
    v_incoming_deleted_at := least((p_day->>'deleted_at')::timestamptz, now());
  else
    v_incoming_deleted_at := null;
  end if;

  v_metrics := public.attendance_compute_day_metrics(p_day, v_target_user_key);

  insert into public.attendance_days as d(
    user_key, date, type, start_time, end_time, manual_break, break_minutes,
    doctor_full_day, doctor_start, doctor_end, other_minutes,
    worked_minutes, credited_minutes, target_minutes, balance_minutes,
    note, deleted_at, updated_at
  ) values (
    v_target_user_key,
    v_date,
    coalesce(p_day->>'type', 'work'),
    coalesce(p_day->>'start_time', ''),
    coalesce(p_day->>'end_time', ''),
    coalesce((p_day->>'manual_break')::boolean, false),
    (v_metrics->>'break_minutes')::integer,
    coalesce((p_day->>'doctor_full_day')::boolean, false),
    coalesce(p_day->>'doctor_start', ''),
    coalesce(p_day->>'doctor_end', ''),
    coalesce((p_day->>'other_minutes')::integer, 0),
    (v_metrics->>'worked_minutes')::integer,
    (v_metrics->>'credited_minutes')::integer,
    (v_metrics->>'target_minutes')::integer,
    (v_metrics->>'balance_minutes')::integer,
    coalesce(p_day->>'note', ''),
    v_incoming_deleted_at,
    v_incoming_updated_at
  )
  on conflict(user_key, date)
  do update set
    type = excluded.type,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    manual_break = excluded.manual_break,
    break_minutes = excluded.break_minutes,
    doctor_full_day = excluded.doctor_full_day,
    doctor_start = excluded.doctor_start,
    doctor_end = excluded.doctor_end,
    other_minutes = excluded.other_minutes,
    worked_minutes = excluded.worked_minutes,
    credited_minutes = excluded.credited_minutes,
    target_minutes = excluded.target_minutes,
    balance_minutes = excluded.balance_minutes,
    note = excluded.note,
    deleted_at = excluded.deleted_at,
    updated_at = excluded.updated_at
  where excluded.updated_at >= d.updated_at
  returning * into v_result_row;

  if found then
    return jsonb_build_object(
      'applied', true,
      'action', case when v_incoming_deleted_at is not null then 'tombstone' else 'upsert' end,
      'date', v_date,
      'server_updated_at', v_result_row.updated_at,
      'worked_minutes', v_result_row.worked_minutes,
      'credited_minutes', v_result_row.credited_minutes,
      'target_minutes', v_result_row.target_minutes,
      'balance_minutes', v_result_row.balance_minutes,
      'break_minutes', v_result_row.break_minutes
    );
  end if;

  select * into v_existing_server
  from public.attendance_days
  where user_key = v_target_user_key and date = v_date;

  return jsonb_build_object(
    'applied', false,
    'reason', 'server_newer',
    'server_updated_at', v_existing_server.updated_at,
    'incoming_updated_at', v_incoming_updated_at,
    'date', v_date
  );
end;
$$;

-- Recalculate existing derived values using the new trusted server rules.
with calculated as (
  select d.user_key, d.date, public.attendance_compute_day_metrics(to_jsonb(d), d.user_key) as m
  from public.attendance_days d
)
update public.attendance_days d
set break_minutes = (c.m->>'break_minutes')::integer,
    worked_minutes = (c.m->>'worked_minutes')::integer,
    credited_minutes = (c.m->>'credited_minutes')::integer,
    target_minutes = (c.m->>'target_minutes')::integer,
    balance_minutes = (c.m->>'balance_minutes')::integer
from calculated c
where d.user_key = c.user_key and d.date = c.date;

-- --------------------------------------------------------------------------
-- 6. Future-object least privilege.
-- Applies to objects subsequently created by the role executing this migration.
-- --------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Keep required client RPC grants explicit after CREATE OR REPLACE.
revoke all on function public.registration_status() from public, anon, authenticated;
revoke all on function public.register_user_with_invite(text, text, text, text) from public, anon, authenticated;
revoke all on function public.change_attendance_pin(text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_reset_user_pin(text, text) from public, anon, authenticated;
revoke all on function public.upsert_attendance_day_lww(jsonb) from public, anon, authenticated;
grant execute on function public.registration_status() to anon, authenticated;
grant execute on function public.register_user_with_invite(text, text, text, text) to anon, authenticated;
grant execute on function public.change_attendance_pin(text, text, boolean) to anon, authenticated;
grant execute on function public.admin_reset_user_pin(text, text) to anon, authenticated;
grant execute on function public.upsert_attendance_day_lww(jsonb) to anon, authenticated;

commit;
