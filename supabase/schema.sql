-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – KOMPLETNÍ SCHÉMA ČISTÉ DATABÁZE (PostgreSQL pro Supabase)
-- ============================================================================
-- Tento skript slouží pro čistou inicializaci celé databáze.
--
-- 1. AUTENTIZACE:
--    - Přihlašování pouze přes: uživatelské jméno + PIN
--    - Žádný externí uživatelský účet ani e-mail
--    - Serverové hashování PINu pomocí bcrypt (pgcrypto)
--    - Oddělené citlivé tabulky: attendance_credentials a attendance_sessions
--    - 256-bitové náhodné session tokeny (v DB se ukládá pouze SHA-256 hash)
--    - Klient posílá session token v HTTP hlavičce X-Attendance-Session
--    - Ochrana proti brute-force (lockout counter se ukládá i při chybě, sjednocený timing)
--
-- 2. AUTORIZACE A OMEZENÍ REST PŘÍSTUPU:
--    - Přímý zápis (INSERT/UPDATE/DELETE) do attendance_days a attendance_profiles přes REST je ZAKÁZÁN
--    - Zápis docházky probíhá výhradně přes RPC upsert_attendance_day_lww
--    - Zápis nastavení probíhá výhradně přes RPC update_own_settings
--    - attendance_credentials a attendance_sessions jsou pro REST zcela nepřístupné
--
-- 3. REGISTRACE NA POZVÁNKY (Invite-Only):
--    - Registrace vždy vyžaduje platný kód pozvánky (žádný auto-admin fallback)
--    - První administrátor se zakládá přes skript supabase/bootstrap_admin.sql
--    - Podporované role: 'admin', 'employee'
--
-- 4. ATOMICKÝ LAST-WRITE-WINS A TOMBSTONES:
--    - Atomický LWW upsert dnů docházky (ON CONFLICT DO UPDATE WHERE newer)
--    - Smazání vytváří soft tombstone (deleted_at), který se spolehlivě šíří
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. UŽIVATELÉ A PROFILY (attendance_profiles)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_profiles (
  user_key text primary key,
  username text not null unique,
  display_name text not null default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),

  -- Běžná pracovní doba
  work_start text not null default '06:30',
  work_end text not null default '15:30',
  daily_target_minutes integer not null default 510 check (daily_target_minutes between 0 and 1440),
  break_minutes integer not null default 30 check (break_minutes between 0 and 240),
  break_after_minutes integer not null default 360 check (break_after_minutes between 0 and 1440),
  auto_fill boolean not null default true,

  -- Práce o víkendu a pracovní dny v týdnu (1=Po, 2=Út, 3=St, 4=Čt, 5=Pá, 6=So, 0=Ne)
  work_days integer[] not null default '{1,2,3,4,5}',
  work_weekends boolean not null default false,
  weekend_mode text not null default 'none' check (weekend_mode in ('none', 'saturday', 'sunday', 'both', 'custom')),
  weekend_custom_hours boolean not null default false,
  weekend_start text not null default '07:00',
  weekend_end text not null default '15:30',
  weekend_target_minutes integer not null default 480 check (weekend_target_minutes between 0 and 1440),
  work_on_holidays boolean not null default false,

  -- Vzhled
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),

  -- Doplňující JSON nastavení
  settings_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_attendance_profiles_username
  on public.attendance_profiles (lower(username));

create index if not exists idx_attendance_profiles_role
  on public.attendance_profiles (role);

-- ----------------------------------------------------------------------------
-- 2. PŘIHLAŠOVACÍ ÚDAJE (attendance_credentials) - SERVER ONLY
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_credentials (
  user_key text primary key references public.attendance_profiles(user_key) on delete cascade,
  pin_password_hash text not null,
  failed_login_count integer not null default 0,
  locked_until timestamptz default null,
  last_failed_login_at timestamptz default null,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. TABULKA RELACÍ (attendance_sessions) - SERVER ONLY
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_key text not null references public.attendance_profiles(user_key) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz default null,
  user_agent text default null
);

create index if not exists idx_attendance_sessions_user_key
  on public.attendance_sessions (user_key);

create index if not exists idx_attendance_sessions_active
  on public.attendance_sessions (token_hash)
  where revoked_at is null;

-- ----------------------------------------------------------------------------
-- 4. SYSTÉM POZVÁNEK (attendance_invites)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_invites (
  code text primary key,
  created_by text references public.attendance_profiles(user_key) on delete cascade,
  target_role text not null default 'employee' check (target_role in ('employee', 'admin')),
  is_used boolean not null default false,
  used_by text references public.attendance_profiles(user_key) on delete set null,
  used_at timestamptz,
  expires_at timestamptz default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_invites_code
  on public.attendance_invites (upper(code));

-- ----------------------------------------------------------------------------
-- 5. DNY DOCHÁZKY (attendance_days)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_days (
  user_key text not null references public.attendance_profiles(user_key) on delete cascade,
  date date not null,
  type text not null default 'work' check (
    type in (
      'work',
      'homeOffice',
      'businessTrip',
      'vacation',
      'halfVacation',
      'doctor',
      'sick',
      'holiday',
      'compTime',
      'other'
    )
  ),
  start_time text not null default '',
  end_time text not null default '',
  manual_break boolean not null default false,
  break_minutes integer not null default 0 check (break_minutes between 0 and 240),
  doctor_full_day boolean not null default false,
  doctor_start text not null default '',
  doctor_end text not null default '',
  other_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  credited_minutes integer not null default 0,
  target_minutes integer not null default 0,
  balance_minutes integer not null default 0,
  note text not null default '',
  deleted_at timestamptz default null,
  updated_at timestamptz not null default now(),
  primary key (user_key, date)
);

create index if not exists idx_attendance_days_date
  on public.attendance_days (date);

create index if not exists idx_attendance_days_user_date
  on public.attendance_days (user_key, date);

create index if not exists idx_attendance_days_deleted
  on public.attendance_days (user_key, deleted_at);

create index if not exists idx_attendance_days_updated
  on public.attendance_days (user_key, updated_at);

-- ----------------------------------------------------------------------------
-- 6. POHLED: MĚSÍČNÍ SOUHRN PRO REPORTING
-- ----------------------------------------------------------------------------
create or replace view public.v_monthly_attendance_summary
with (security_invoker = true)
as
select
  d.user_key,
  p.username,
  p.display_name,
  to_char(d.date, 'YYYY-MM') as month,
  count(d.date) filter (where d.deleted_at is null) as total_days_recorded,
  sum(d.worked_minutes) filter (where d.deleted_at is null) as total_worked_minutes,
  sum(d.credited_minutes) filter (where d.deleted_at is null) as total_credited_minutes,
  sum(d.target_minutes) filter (where d.deleted_at is null) as total_target_minutes,
  sum(d.balance_minutes) filter (where d.deleted_at is null) as total_balance_minutes,
  count(d.date) filter (where d.type in ('vacation', 'halfVacation') and d.deleted_at is null) as vacation_days_count,
  count(d.date) filter (where d.type = 'doctor' and d.deleted_at is null) as doctor_days_count,
  count(d.date) filter (where d.type = 'sick' and d.deleted_at is null) as sick_days_count,
  max(d.updated_at) as last_updated_at
from public.attendance_days d
join public.attendance_profiles p on p.user_key = d.user_key
group by d.user_key, p.username, p.display_name, to_char(d.date, 'YYYY-MM');

-- ----------------------------------------------------------------------------
-- 7. POMOCNÉ AUTENTIZAČNÍ FUNKCE
-- ----------------------------------------------------------------------------

-- Získání user-agent hlavičky klienta
create or replace function public.current_client_user_agent()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true)::json->>'user-agent', ''),
    'unknown'
  );
$$;

-- Získání RAW session tokenu z HTTP hlavičky X-Attendance-Session
create or replace function public.current_session_token()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true)::json->>'x-attendance-session', ''),
    ''
  );
$$;

-- Ověření session tokenu a vrácení přihlášeného user_key
create or replace function public.current_session_user_key()
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_raw_token text;
  v_token_hash text;
  v_user_key text;
begin
  v_raw_token := public.current_session_token();
  if v_raw_token = '' then
    return '';
  end if;

  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  select s.user_key into v_user_key
  from public.attendance_sessions s
  join public.attendance_profiles p on p.user_key = s.user_key
  where s.token_hash = v_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  return coalesce(v_user_key, '');
end;
$$;

-- Ověření administrátorských práv ze session tokenu
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_key text;
  v_is_admin boolean;
begin
  v_user_key := public.current_session_user_key();
  if v_user_key = '' then
    return false;
  end if;

  select exists (
    select 1
    from public.attendance_profiles
    where user_key = v_user_key
      and role = 'admin'
  ) into v_is_admin;

  return coalesce(v_is_admin, false);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. SESSION A AUTH RPC FUNKCE
-- ----------------------------------------------------------------------------

-- Přihlášení: ověření PINu přes bcrypt, brute-force ochrana a ochrana proti timing útokům
create or replace function public.login_attendance_user(
  p_username text,
  p_pin text,
  p_remember boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_clean_user text;
  v_user_key text;
  v_profile public.attendance_profiles%rowtype;
  v_cred public.attendance_credentials%rowtype;
  v_is_valid boolean := false;
  v_new_failed integer;
  v_lock_until timestamptz;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
begin
  v_clean_user := lower(trim(regexp_replace(p_username, '[^a-zA-Z0-9._-]', '', 'g')));
  v_user_key := 'user:' || v_clean_user;

  select * into v_profile
  from public.attendance_profiles
  where user_key = v_user_key;

  if not found then
    -- Timing attack equalizace: spustíme bcrypt simulaci, aby nebylo možné odlišit existujícího uživatele podle času odezvy
    perform crypt(p_pin, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUUWXYZ123456');
    return jsonb_build_object(
      'success', false,
      'error', 'invalid_credentials',
      'message', 'Neplatné uživatelské jméno nebo PIN.'
    );
  end if;

  select * into v_cred
  from public.attendance_credentials
  where user_key = v_user_key
  for update;

  if not found then
    perform crypt(p_pin, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUUWXYZ123456');
    return jsonb_build_object(
      'success', false,
      'error', 'invalid_credentials',
      'message', 'Neplatné uživatelské jméno nebo PIN.'
    );
  end if;

  -- Kontrola dočasného zámku účtu
  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object(
      'success', false,
      'error', 'account_locked',
      'message', 'Účet je dočasně uzamčen z bezpečnostních důvodů. Zkuste to za chvíli.',
      'locked_until', v_cred.locked_until
    );
  end if;

  -- Ověření PINu přes bcrypt
  v_is_valid := (crypt(p_pin, v_cred.pin_password_hash) = v_cred.pin_password_hash);

  if not v_is_valid then
    v_new_failed := v_cred.failed_login_count + 1;
    v_lock_until := null;

    if v_new_failed >= 10 then
      v_lock_until := now() + interval '15 minutes';
    elsif v_new_failed >= 5 then
      v_lock_until := now() + interval '2 minutes';
    end if;

    update public.attendance_credentials
    set failed_login_count = v_new_failed,
        last_failed_login_at = now(),
        locked_until = v_lock_until,
        updated_at = now()
    where user_key = v_user_key;

    if v_lock_until is not null then
      return jsonb_build_object(
        'success', false,
        'error', 'account_locked',
        'message', 'Příliš mnoho neúspěšných pokusů. Účet byl dočasně uzamčen.',
        'locked_until', v_lock_until
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'error', 'invalid_credentials',
      'message', 'Neplatné uživatelské jméno nebo PIN.',
      'failed_attempts', v_new_failed
    );
  end if;

  -- Úspěšné ověření -> vyresetujeme čítač chyb
  update public.attendance_credentials
  set failed_login_count = 0,
      locked_until = null,
      updated_at = now()
  where user_key = v_user_key;

  -- Vygenerování kryptograficky náhodného session tokenu (256-bit entropy)
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  if p_remember then
    v_expires_at := now() + interval '30 days';
  else
    v_expires_at := now() + interval '1 day';
  end if;

  insert into public.attendance_sessions (
    user_key,
    token_hash,
    expires_at,
    created_at,
    last_used_at,
    user_agent
  ) values (
    v_user_key,
    v_token_hash,
    v_expires_at,
    now(),
    now(),
    public.current_client_user_agent()
  );

  return jsonb_build_object(
    'success', true,
    'session_token', v_raw_token,
    'user_key', v_profile.user_key,
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'role', v_profile.role,
    'expires_at', v_expires_at
  );
end;
$$;

-- Odhlášení: serverová revokace session tokenu
create or replace function public.logout_attendance_session(
  p_all_devices boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_raw_token text;
  v_token_hash text;
  v_user_key text;
begin
  v_raw_token := public.current_session_token();
  if v_raw_token = '' then
    return false;
  end if;

  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  if p_all_devices then
    v_user_key := public.current_session_user_key();
    if v_user_key <> '' then
      update public.attendance_sessions
      set revoked_at = now()
      where user_key = v_user_key and revoked_at is null;
      return true;
    end if;
  else
    update public.attendance_sessions
    set revoked_at = now()
    where token_hash = v_token_hash and revoked_at is null;
    return true;
  end if;

  return false;
end;
$$;

-- Ověření session při načtení PWA (optimalizovaná aktualizace last_used_at max 1x za hodinu)
create or replace function public.verify_attendance_session()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_raw_token text;
  v_token_hash text;
  v_profile public.attendance_profiles%rowtype;
begin
  v_raw_token := public.current_session_token();
  if v_raw_token = '' then
    return jsonb_build_object('success', false, 'error', 'missing_session', 'message', 'Chybí session token.');
  end if;

  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  select p.* into v_profile
  from public.attendance_sessions s
  join public.attendance_profiles p on p.user_key = s.user_key
  where s.token_hash = v_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_session', 'message', 'Session expirovala nebo byla odhlášena.');
  end if;

  -- Aktualizujeme last_used_at maximálně jednou za hodinu, aby se nezatěžovala databáze
  update public.attendance_sessions
  set last_used_at = now()
  where token_hash = v_token_hash
    and last_used_at < now() - interval '1 hour';

  return jsonb_build_object(
    'success', true,
    'user_key', v_profile.user_key,
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'role', v_profile.role
  );
end;
$$;

-- Změna PINu: ověří původní PIN a revokuje všechny ostatní aktivní sessions
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
  v_cred public.attendance_credentials%rowtype;
  v_old_valid boolean := false;
  v_new_bcrypt text;
begin
  v_user_key := public.current_session_user_key();
  if v_user_key = '' then
    return jsonb_build_object('success', false, 'error', 'unauthorized', 'message', 'Uživatel není přihlášen.');
  end if;

  if length(p_new_pin) < 4 then
    return jsonb_build_object('success', false, 'error', 'pin_too_short', 'message', 'Nový PIN musí mít alespoň 4 znaky.');
  end if;

  select * into v_cred
  from public.attendance_credentials
  where user_key = v_user_key
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found', 'message', 'Uživatel nebyl nalezen.');
  end if;

  v_old_valid := (crypt(p_old_pin, v_cred.pin_password_hash) = v_cred.pin_password_hash);

  if not v_old_valid then
    return jsonb_build_object('success', false, 'error', 'invalid_old_pin', 'message', 'Původní PIN není správný.');
  end if;

  v_new_bcrypt := crypt(p_new_pin, gen_salt('bf', 10));

  update public.attendance_credentials
  set pin_password_hash = v_new_bcrypt,
      failed_login_count = 0,
      locked_until = null,
      updated_at = now()
  where user_key = v_user_key;

  -- Bezpečnostní revokace sessions: zneplatníme ostatní relace uživatele
  if p_revoke_others then
    v_raw_token := public.current_session_token();
    v_current_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

    update public.attendance_sessions
    set revoked_at = now()
    where user_key = v_user_key
      and token_hash <> v_current_token_hash
      and revoked_at is null;
  else
    -- Revokovat úplně všechny
    update public.attendance_sessions
    set revoked_at = now()
    where user_key = v_user_key
      and revoked_at is null;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'PIN byl úspěšně změněn.'
  );
end;
$$;

-- Registrace s VÝHRADNÍM ověřením pozvánky (žádný auto-admin fallback)
drop function if exists public.register_user_with_invite(text, text, text, text);
create or replace function public.register_user_with_invite(
  p_username text,
  p_display_name text,
  p_pin text,
  p_invite_code text
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
  v_assigned_role text;
  v_bcrypt text;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
begin
  v_clean_user := lower(trim(regexp_replace(p_username, '[^a-zA-Z0-9._-]', '', 'g')));
  if length(v_clean_user) < 3 then
    return jsonb_build_object('success', false, 'error', 'invalid_username', 'message', 'Uživatelské jméno musí mít alespoň 3 znaky.');
  end if;
  if length(p_pin) < 4 then
    return jsonb_build_object('success', false, 'error', 'pin_too_short', 'message', 'PIN/heslo musí mít alespoň 4 znaky.');
  end if;
  v_user_key := 'user:' || v_clean_user;

  -- 1. Ověření pozvánky VŽDY před kontrolou dostupnosti jména (prevence enumeration)
  if coalesce(trim(p_invite_code), '') = '' then
    return jsonb_build_object('success', false, 'error', 'missing_invite', 'message', 'Registrace vyžaduje platný kód pozvánky.');
  end if;

  select * into v_invite
  from public.attendance_invites
  where upper(code) = upper(trim(p_invite_code))
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_invite', 'message', 'Kód pozvánky neexistuje nebo je neplatný.');
  end if;

  if v_invite.is_used then
    return jsonb_build_object('success', false, 'error', 'invite_used', 'message', 'Tento kód pozvánky již byl využit.');
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    return jsonb_build_object('success', false, 'error', 'invite_expired', 'message', 'Platnost tohoto kódu pozvánky vypršela.');
  end if;

  v_assigned_role := coalesce(v_invite.target_role, 'employee');

  -- 2. Kontrola unikátnosti uživatelského jména
  if exists (select 1 from public.attendance_profiles where user_key = v_user_key) then
    return jsonb_build_object('success', false, 'error', 'username_taken', 'message', 'Uživatelské jméno je již obsazeno.');
  end if;

  v_bcrypt := crypt(p_pin, gen_salt('bf', 10));

  -- Vložení veřejného profilu
  insert into public.attendance_profiles (
    user_key,
    username,
    display_name,
    role
  ) values (
    v_user_key,
    v_clean_user,
    coalesce(nullif(trim(p_display_name), ''), v_clean_user),
    v_assigned_role
  );

  -- Vložení privátních přihlašovacích údajů
  insert into public.attendance_credentials (
    user_key,
    pin_password_hash,
    failed_login_count,
    locked_until
  ) values (
    v_user_key,
    v_bcrypt,
    0,
    null
  );

  -- Označení pozvánky za využitou
  update public.attendance_invites
  set is_used = true,
      used_by = v_user_key,
      used_at = now()
  where code = v_invite.code;

  -- Okamžité vystavení session tokenu pro automatické přihlášení
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '30 days';

  insert into public.attendance_sessions (
    user_key,
    token_hash,
    expires_at,
    created_at,
    last_used_at,
    user_agent
  ) values (
    v_user_key,
    v_token_hash,
    v_expires_at,
    now(),
    now(),
    public.current_client_user_agent()
  );

  return jsonb_build_object(
    'success', true,
    'session_token', v_raw_token,
    'user_key', v_user_key,
    'username', v_clean_user,
    'display_name', coalesce(nullif(trim(p_display_name), ''), v_clean_user),
    'role', v_assigned_role,
    'expires_at', v_expires_at,
    'message', 'Registrace proběhla úspěšně.'
  );
end;
$$;

-- Anonymní stav registrace pro návštěvníky
create or replace function public.registration_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object(
    'registration_enabled', true,
    'requires_invite', true
  );
end;
$$;

-- Bezpečná aktualizace vlastního nastavení přes RPC (přímý REST UPDATE je zakázán)
create or replace function public.update_own_settings(
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_key text;
  v_result public.attendance_profiles%rowtype;
begin
  v_user_key := public.current_session_user_key();
  if v_user_key = '' then
    raise exception 'Neautorizovaný přístup: Neplatná nebo chybějící session.';
  end if;

  update public.attendance_profiles
  set
    work_start = coalesce(p_settings->>'work_start', work_start),
    work_end = coalesce(p_settings->>'work_end', work_end),
    daily_target_minutes = coalesce((p_settings->>'daily_target_minutes')::integer, daily_target_minutes),
    break_minutes = coalesce((p_settings->>'break_minutes')::integer, break_minutes),
    break_after_minutes = coalesce((p_settings->>'break_after_minutes')::integer, break_after_minutes),
    auto_fill = coalesce((p_settings->>'auto_fill')::boolean, auto_fill),
    work_weekends = coalesce((p_settings->>'work_weekends')::boolean, work_weekends),
    weekend_mode = coalesce(p_settings->>'weekend_mode', weekend_mode),
    weekend_custom_hours = coalesce((p_settings->>'weekend_custom_hours')::boolean, weekend_custom_hours),
    weekend_start = coalesce(p_settings->>'weekend_start', weekend_start),
    weekend_end = coalesce(p_settings->>'weekend_end', weekend_end),
    weekend_target_minutes = coalesce((p_settings->>'weekend_target_minutes')::integer, weekend_target_minutes),
    work_on_holidays = coalesce((p_settings->>'work_on_holidays')::boolean, work_on_holidays),
    theme = coalesce(p_settings->>'theme', theme),
    settings_json = coalesce(p_settings->'settings_json', settings_json),
    updated_at = now()
  where user_key = v_user_key
  returning * into v_result;

  if not found then
    raise exception 'Uživatelský profil nebyl nalezen.';
  end if;

  return jsonb_build_object(
    'success', true,
    'user_key', v_result.user_key,
    'username', v_result.username,
    'display_name', v_result.display_name,
    'role', v_result.role,
    'updated_at', v_result.updated_at
  );
end;
$$;

-- Správce: generování pozvánky
create or replace function public.admin_create_invite(
  p_target_role text default 'employee'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code text;
  v_expires timestamptz;
  v_creator text;
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může generovat pozvánky.';
  end if;

  if p_target_role not in ('employee', 'admin') then
    raise exception 'Neplatná role. Podporované role: employee, admin.';
  end if;

  v_creator := public.current_session_user_key();
  v_code := 'INV-' || upper(encode(gen_random_bytes(16), 'hex'));
  v_expires := now() + interval '14 days';

  insert into public.attendance_invites (
    code,
    created_by,
    target_role,
    expires_at
  ) values (
    v_code,
    v_creator,
    p_target_role,
    v_expires
  );

  return jsonb_build_object(
    'code', v_code,
    'target_role', p_target_role,
    'expires_at', v_expires,
    'created_at', now()
  );
end;
$$;

-- Správce: reset PINu uživatele (okamžitě revokuje VŠECHNY aktivní sessions daného uživatele)
drop function if exists public.admin_reset_user_pin(text, text);
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

  if length(p_new_pin) < 4 then
    raise exception 'PIN musí mít alespoň 4 znaky.';
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

  -- Bezpečnostní revokace VŠECH relací cílového uživatele (žádný token nesmí zůstat funkční)
  update public.attendance_sessions
  set revoked_at = now()
  where user_key = p_target_user_key
    and revoked_at is null;

  return true;
end;
$$;

-- Správce: změna role uživatele
create or replace function public.admin_change_user_role(
  p_target_user_key text,
  p_new_role text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může měnit role.';
  end if;

  if p_new_role not in ('admin', 'employee') then
    raise exception 'Neplatná role. Podporované role: employee, admin.';
  end if;

  update public.attendance_profiles
  set role = p_new_role,
      updated_at = now()
  where user_key = p_target_user_key;

  return true;
end;
$$;

-- Správce: smazání uživatele (čistý kaskádový úklid profilu, credentials, sessions i pozvánek)
create or replace function public.admin_delete_user(
  p_target_user_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může mazat uživatele.';
  end if;

  if p_target_user_key = public.current_session_user_key() then
    raise exception 'Nemůžeš smazat svůj vlastní přihlášený administrátorský účet.';
  end if;

  -- Úklid pozvánek vytvořených tímto uživatelem
  delete from public.attendance_invites
  where created_by = p_target_user_key;

  -- Kaskádové smazání profilu (díky ON DELETE CASCADE smaže credentials, sessions a attendance_days)
  delete from public.attendance_profiles
  where user_key = p_target_user_key;

  return true;
end;
$$;

-- Správce: bezpečný úklid starých smazaných záznamů (tombstones)
create or replace function public.admin_cleanup_old_tombstones(
  p_retention_days integer default 90
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_count integer;
  v_cutoff timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může provádět údržbu databáze.';
  end if;

  v_cutoff := now() - (coalesce(p_retention_days, 90) || ' days')::interval;

  delete from public.attendance_days
  where deleted_at is not null
    and deleted_at < v_cutoff;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

-- Atomický Last-Write-Wins (LWW) upsert dnů docházky s autorizací přes session token
create or replace function public.upsert_attendance_day_lww(
  p_day jsonb
)
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

  v_incoming_updated_at := coalesce(
    (p_day->>'updated_at')::timestamptz,
    now()
  );

  v_incoming_deleted_at := (p_day->>'deleted_at')::timestamptz;

  insert into public.attendance_days as d (
    user_key,
    date,
    type,
    start_time,
    end_time,
    manual_break,
    break_minutes,
    doctor_full_day,
    doctor_start,
    doctor_end,
    other_minutes,
    worked_minutes,
    credited_minutes,
    target_minutes,
    balance_minutes,
    note,
    deleted_at,
    updated_at
  ) values (
    v_target_user_key,
    v_date,
    coalesce(p_day->>'type', 'work'),
    coalesce(p_day->>'start_time', ''),
    coalesce(p_day->>'end_time', ''),
    coalesce((p_day->>'manual_break')::boolean, false),
    coalesce((p_day->>'break_minutes')::integer, 0),
    coalesce((p_day->>'doctor_full_day')::boolean, false),
    coalesce(p_day->>'doctor_start', ''),
    coalesce(p_day->>'doctor_end', ''),
    coalesce((p_day->>'other_minutes')::integer, 0),
    coalesce((p_day->>'worked_minutes')::integer, 0),
    coalesce((p_day->>'credited_minutes')::integer, 0),
    coalesce((p_day->>'target_minutes')::integer, 0),
    coalesce((p_day->>'balance_minutes')::integer, 0),
    coalesce(p_day->>'note', ''),
    v_incoming_deleted_at,
    v_incoming_updated_at
  )
  on conflict (user_key, date)
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
      'action', case
        when v_incoming_deleted_at is not null then 'tombstone'
        else 'upsert'
      end,
      'date', v_date,
      'server_updated_at', v_result_row.updated_at
    );
  else
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
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. ZABEZPEČENÍ ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
alter table public.attendance_profiles enable row level security;
alter table public.attendance_credentials enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_invites enable row level security;
alter table public.attendance_days enable row level security;

-- PROFILY (attendance_profiles): pouze SELECT
drop policy if exists "Secure read profiles" on public.attendance_profiles;
create policy "Secure read profiles"
  on public.attendance_profiles
  for select
  to anon, authenticated
  using (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  );

-- POZVÁNKY (attendance_invites): správce spravuje pozvánky
drop policy if exists "Admin manage invites" on public.attendance_invites;
create policy "Admin manage invites"
  on public.attendance_invites
  for all
  to anon, authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DNY DOCHÁZKY (attendance_days): pouze SELECT přes RLS (zápis je přes RPC)
drop policy if exists "Secure read own attendance days" on public.attendance_days;
create policy "Secure read own attendance days"
  on public.attendance_days
  for select
  to anon, authenticated
  using (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 10. OPRÁVNĚNÍ K TABULKÁM (PRINCIPLE OF LEAST PRIVILEGE)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- Úplný zákaz přímého REST přístupu k interním tabulkám
revoke all on public.attendance_credentials from public, anon, authenticated;
revoke all on public.attendance_sessions from public, anon, authenticated;

-- attendance_profiles: POUZE SELECT pro REST klienty (úpravy jdou přes update_own_settings)
grant select on public.attendance_profiles to anon, authenticated;
revoke insert, update, delete on public.attendance_profiles from public, anon, authenticated;

-- attendance_days: POUZE SELECT pro REST klienty (zápis jde přes upsert_attendance_day_lww)
grant select on public.attendance_days to anon, authenticated;
revoke insert, update, delete on public.attendance_days from public, anon, authenticated;

-- attendance_invites: SELECT a administrátorská správa
grant select on public.attendance_invites to anon, authenticated;
revoke insert, update, delete on public.attendance_invites from public, anon;
grant insert, update, delete on public.attendance_invites to authenticated;

-- ----------------------------------------------------------------------------
-- 11. OPRÁVNĚNÍ K FUNKCÍM (EXPLICITNÍ REVOKE + POUZE VYŽADOVANÉ GRANTS)
-- ----------------------------------------------------------------------------

-- P0.1 Explicitní REVOKE ALL ze všech funkcí pro PUBLIC, anon i authenticated
revoke all on function public.current_client_user_agent() from public, anon, authenticated;
revoke all on function public.current_session_token() from public, anon, authenticated;
revoke all on function public.current_session_user_key() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.login_attendance_user(text, text, boolean) from public, anon, authenticated;
revoke all on function public.logout_attendance_session(boolean) from public, anon, authenticated;
revoke all on function public.verify_attendance_session() from public, anon, authenticated;
revoke all on function public.change_attendance_pin(text, text, boolean) from public, anon, authenticated;
revoke all on function public.register_user_with_invite(text, text, text, text) from public, anon, authenticated;
revoke all on function public.registration_status() from public, anon, authenticated;
revoke all on function public.update_own_settings(jsonb) from public, anon, authenticated;
revoke all on function public.admin_create_invite(text) from public, anon, authenticated;
revoke all on function public.admin_reset_user_pin(text, text) from public, anon, authenticated;
revoke all on function public.admin_change_user_role(text, text) from public, anon, authenticated;
revoke all on function public.admin_delete_user(text) from public, anon, authenticated;
revoke all on function public.admin_cleanup_old_tombstones(integer) from public, anon, authenticated;
revoke all on function public.upsert_attendance_day_lww(jsonb) from public, anon, authenticated;

-- P0.1 Udělení EXECUTE pouze pro funkce vyžadované klientem:

-- 1. Veřejné (anonymní) vstupní brány:
grant execute on function public.login_attendance_user(text, text, boolean) to anon, authenticated;
grant execute on function public.register_user_with_invite(text, text, text, text) to anon, authenticated;
grant execute on function public.registration_status() to anon, authenticated;

-- 2. Pomocné funkce pro RLS a zjištění identity:
grant execute on function public.current_client_user_agent() to anon, authenticated;
grant execute on function public.current_session_token() to anon, authenticated;
grant execute on function public.current_session_user_key() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- 3. Běžné uživatelské operace (vyžadují uvnitř platný session token v X-Attendance-Session):
grant execute on function public.logout_attendance_session(boolean) to anon, authenticated;
grant execute on function public.verify_attendance_session() to anon, authenticated;
grant execute on function public.change_attendance_pin(text, text, boolean) to anon, authenticated;
grant execute on function public.update_own_settings(jsonb) to anon, authenticated;
grant execute on function public.upsert_attendance_day_lww(jsonb) to anon, authenticated;

-- 4. Administrátorské operace (vyžadují uvnitř session token s rolí admin):
grant execute on function public.admin_create_invite(text) to anon, authenticated;
grant execute on function public.admin_reset_user_pin(text, text) to anon, authenticated;
grant execute on function public.admin_change_user_role(text, text) to anon, authenticated;
grant execute on function public.admin_delete_user(text) to anon, authenticated;
grant execute on function public.admin_cleanup_old_tombstones(integer) to anon, authenticated;
