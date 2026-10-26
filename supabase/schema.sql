-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – DATABÁZE PRO SUPABASE (PostgreSQL)
-- ============================================================================
-- Databáze pro aplikaci Osobní docházka:
-- 1. AUTENTIZACE POMOCÍ SESSION TOKENŮ:
--    - Přihlášení přes uživatelské jméno + PIN
--    - Serverové ověření PINu pomocí bcrypt (pgcrypto)
--    - Vystavení kryptograficky bezpečného 256-bitového session tokenu
--    - V databázi se ukládá pouze SHA-256 hash tokenu
--    - Klient posílá session token v HTTP hlavičce X-Attendance-Session
--    - Žádné e-maily, žádný Supabase Auth
--
-- 2. ROW LEVEL SECURITY (RLS):
--    - Veškeré operace jsou autorizovány podle platného session tokenu
--    - Uživatel má plný přístup výhradně ke svým datům
--    - Správce (role: admin) má přístup k přehledům týmu a správě pozvánek
--
-- 3. INVITE-ONLY REGISTRACE:
--    - První registrovaný uživatel se automaticky stává Správcem (admin) bez pozvánky
--    - Každý další uživatel se může registrovat pouze s platným kódem pozvánky
--    - Prevence username enumeration: pozvánka je ověřena před kontrolou jména
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. UŽIVATELÉ A JEJICH PROFILY (attendance_profiles)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_profiles (
  user_key text primary key,
  username text not null unique,
  display_name text not null default '',
  pin_password_hash text,
  auth_version integer not null default 2,
  pin_hash text default null, -- legacy sloupec pro plynulý přechod
  failed_login_count integer not null default 0,
  locked_until timestamptz default null,
  last_failed_login_at timestamptz default null,
  legacy_migrated_at timestamptz default null,
  role text not null default 'employee' check (role in ('admin', 'manager', 'employee')),

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
-- 2. TABULKA RELACÍ (attendance_sessions)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_key text not null references public.attendance_profiles(user_key) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz default null,
  user_agent text default null
);

create unique index if not exists idx_attendance_sessions_token_hash
  on public.attendance_sessions(token_hash);

create index if not exists idx_attendance_sessions_user_key
  on public.attendance_sessions(user_key);

create index if not exists idx_attendance_sessions_active
  on public.attendance_sessions(token_hash)
  where revoked_at is null;

-- ----------------------------------------------------------------------------
-- 3. SYSTÉM POZVÁNEK (attendance_invites)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_invites (
  code text primary key,
  created_by text references public.attendance_profiles(user_key) on delete set null,
  target_role text not null default 'employee' check (target_role in ('employee', 'manager', 'admin')),
  is_used boolean not null default false,
  used_by text references public.attendance_profiles(user_key) on delete set null,
  used_at timestamptz,
  expires_at timestamptz default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_invites_code
  on public.attendance_invites (upper(code));

-- ----------------------------------------------------------------------------
-- 4. DNY DOCHÁZKY (attendance_days)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_days (
  user_key text not null references public.attendance_profiles(user_key) on delete cascade,
  date date not null,
  type text not null default 'work' check (type in ('work', 'doctor', 'vacation', 'sick', 'holiday', 'trip', 'homeoffice', 'weekend')),
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

-- ----------------------------------------------------------------------------
-- 5. POHLED: MĚSÍČNÍ SOUHRN PRO REPORTING
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
  count(d.date) filter (where d.type = 'vacation' and d.deleted_at is null) as vacation_days_count,
  count(d.date) filter (where d.type = 'doctor' and d.deleted_at is null) as doctor_days_count,
  count(d.date) filter (where d.type = 'sick' and d.deleted_at is null) as sick_days_count,
  max(d.updated_at) as last_updated_at
from public.attendance_days d
join public.attendance_profiles p on p.user_key = d.user_key
group by d.user_key, p.username, p.display_name, to_char(d.date, 'YYYY-MM');

-- ----------------------------------------------------------------------------
-- 6. POMOCNÉ FUNKCE PRO SESSION AUTENTIZACI
-- ----------------------------------------------------------------------------

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
set search_path = public, extensions
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
set search_path = public, extensions
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
-- 7. SESSION A AUTH RPC FUNKCE
-- ----------------------------------------------------------------------------

-- Přihlášení: ověření PINu (bcrypt / jednorázová migrace ze SHA-256), brute-force ochrana a vystavení session tokenu
create or replace function public.login_attendance_user(
  p_username text,
  p_pin text,
  p_remember boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clean_user text;
  v_user_key text;
  v_profile public.attendance_profiles%rowtype;
  v_is_valid boolean := false;
  v_legacy_hash text;
  v_new_bcrypt text;
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
    raise exception 'Neplatné uživatelské jméno nebo PIN.';
  end if;

  if v_profile.locked_until is not null and v_profile.locked_until > now() then
    raise exception 'Účet je dočasně uzamčen z bezpečnostních důvodů. Zkuste to za chvíli.';
  end if;

  if v_profile.auth_version = 2 and v_profile.pin_password_hash is not null then
    v_is_valid := (crypt(p_pin, v_profile.pin_password_hash) = v_profile.pin_password_hash);
  elsif v_profile.auth_version = 1 and v_profile.pin_hash is not null then
    v_legacy_hash := encode(digest('dochazka:' || v_clean_user || ':' || p_pin, 'sha256'), 'hex');
    if v_legacy_hash = v_profile.pin_hash then
      v_is_valid := true;
      v_new_bcrypt := crypt(p_pin, gen_salt('bf', 10));
      update public.attendance_profiles
      set pin_password_hash = v_new_bcrypt,
          auth_version = 2,
          legacy_migrated_at = now(),
          pin_hash = null,
          failed_login_count = 0,
          locked_until = null,
          updated_at = now()
      where user_key = v_profile.user_key;
    end if;
  end if;

  if not v_is_valid then
    update public.attendance_profiles
    set failed_login_count = failed_login_count + 1,
        last_failed_login_at = now(),
        locked_until = case
          when failed_login_count + 1 >= 10 then now() + interval '5 minutes'
          when failed_login_count + 1 >= 5 then now() + interval '1 minute'
          else null
        end
    where user_key = v_profile.user_key;

    raise exception 'Neplatné uživatelské jméno nebo PIN.';
  end if;

  update public.attendance_profiles
  set failed_login_count = 0,
      locked_until = null
  where user_key = v_profile.user_key;

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
    last_used_at
  ) values (
    v_profile.user_key,
    v_token_hash,
    v_expires_at,
    now(),
    now()
  );

  return jsonb_build_object(
    'session_token', v_raw_token,
    'user_key', v_profile.user_key,
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'role', v_profile.role,
    'expires_at', v_expires_at
  );
end;
$$;

-- Odhlášení
create or replace function public.logout_attendance_session(
  p_all_devices boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
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

-- Ověření session při načtení PWA
create or replace function public.verify_attendance_session()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_raw_token text;
  v_token_hash text;
  v_profile public.attendance_profiles%rowtype;
begin
  v_raw_token := public.current_session_token();
  if v_raw_token = '' then
    raise exception 'Neplatná nebo chybějící session.';
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
    raise exception 'Session expirovala nebo byla odhlášena.';
  end if;

  update public.attendance_sessions
  set last_used_at = now()
  where token_hash = v_token_hash;

  return jsonb_build_object(
    'user_key', v_profile.user_key,
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'role', v_profile.role
  );
end;
$$;

-- Změna PINu přihlášeným uživatelem
create or replace function public.change_attendance_pin(
  p_old_pin text,
  p_new_pin text,
  p_revoke_others boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_key text;
  v_raw_token text;
  v_current_token_hash text;
  v_profile public.attendance_profiles%rowtype;
  v_old_valid boolean := false;
  v_new_bcrypt text;
begin
  v_user_key := public.current_session_user_key();
  if v_user_key = '' then
    raise exception 'Neautorizovaný přístup: Uživatel není přihlášen.';
  end if;

  if length(p_new_pin) < 4 then
    raise exception 'Nový PIN musí mít alespoň 4 znaky.';
  end if;

  select * into v_profile
  from public.attendance_profiles
  where user_key = v_user_key;

  if not found then
    raise exception 'Uživatel nebyl nalezen.';
  end if;

  if v_profile.auth_version = 2 and v_profile.pin_password_hash is not null then
    v_old_valid := (crypt(p_old_pin, v_profile.pin_password_hash) = v_profile.pin_password_hash);
  elsif v_profile.pin_hash is not null then
    v_old_valid := (encode(digest('dochazka:' || v_profile.username || ':' || p_old_pin, 'sha256'), 'hex') = v_profile.pin_hash);
  end if;

  if not v_old_valid then
    raise exception 'Původní PIN není správný.';
  end if;

  v_new_bcrypt := crypt(p_new_pin, gen_salt('bf', 10));

  update public.attendance_profiles
  set pin_password_hash = v_new_bcrypt,
      pin_hash = null,
      auth_version = 2,
      legacy_migrated_at = now(),
      updated_at = now()
  where user_key = v_user_key;

  if p_revoke_others then
    v_raw_token := public.current_session_token();
    v_current_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

    update public.attendance_sessions
    set revoked_at = now()
    where user_key = v_user_key
      and token_hash <> v_current_token_hash
      and revoked_at is null;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'PIN byl úspěšně změněn.'
  );
end;
$$;

-- Registrace s ověřením pozvánky a okamžitým vystavením session tokenu
create or replace function public.register_user_with_invite(
  p_username text,
  p_display_name text,
  p_pin text,
  p_invite_code text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_count integer;
  v_clean_user text;
  v_user_key text;
  v_invite public.attendance_invites%rowtype;
  v_assigned_role text := 'employee';
  v_bcrypt text;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
begin
  v_clean_user := lower(trim(regexp_replace(p_username, '[^a-zA-Z0-9._-]', '', 'g')));
  if length(v_clean_user) < 3 then
    raise exception 'Uživatelské jméno musí mít alespoň 3 znaky.';
  end if;
  if length(p_pin) < 4 then
    raise exception 'PIN/heslo musí mít alespoň 4 znaky.';
  end if;
  v_user_key := 'user:' || v_clean_user;

  select count(*) into v_user_count from public.attendance_profiles;

  if v_user_count = 0 then
    v_assigned_role := 'admin';
  else
    if coalesce(trim(p_invite_code), '') = '' then
      raise exception 'Registrace nových uživatelů je pouze na pozvánky. Zadej platný kód pozvánky.';
    end if;

    select * into v_invite
    from public.attendance_invites
    where upper(code) = upper(trim(p_invite_code))
    for update;

    if not found then
      raise exception 'Kód pozvánky "%" neexistuje nebo je neplatný.', p_invite_code;
    end if;

    if v_invite.is_used then
      raise exception 'Tento kód pozvánky již byl využit.';
    end if;

    if v_invite.expires_at is not null and v_invite.expires_at < now() then
      raise exception 'Platnost tohoto kódu pozvánky vypršela.';
    end if;

    v_assigned_role := coalesce(v_invite.target_role, 'employee');
  end if;

  if exists (select 1 from public.attendance_profiles where user_key = v_user_key) then
    raise exception 'Uživatelské jméno "%" je již obsazeno.', v_clean_user;
  end if;

  v_bcrypt := crypt(p_pin, gen_salt('bf', 10));

  insert into public.attendance_profiles (
    user_key,
    username,
    display_name,
    pin_password_hash,
    role,
    auth_version,
    pin_hash
  ) values (
    v_user_key,
    v_clean_user,
    coalesce(nullif(trim(p_display_name), ''), v_clean_user),
    v_bcrypt,
    v_assigned_role,
    2,
    null
  );

  if v_user_count > 0 and v_invite.code is not null then
    update public.attendance_invites
    set is_used = true,
        used_by = v_user_key,
        used_at = now()
    where code = v_invite.code;
  end if;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '30 days';

  insert into public.attendance_sessions (
    user_key,
    token_hash,
    expires_at,
    created_at,
    last_used_at
  ) values (
    v_user_key,
    v_token_hash,
    v_expires_at,
    now(),
    now()
  );

  return jsonb_build_object(
    'success', true,
    'session_token', v_raw_token,
    'user_key', v_user_key,
    'username', v_clean_user,
    'display_name', coalesce(nullif(trim(p_display_name), ''), v_clean_user),
    'role', v_assigned_role,
    'expires_at', v_expires_at,
    'message', case when v_user_count = 0 then 'První administrátorský profil byl úspěšně vytvořen.' else 'Registrace proběhla úspěšně.' end
  );
end;
$$;

-- Stav registrace pro nepřihlášené návštěvníky (pouze zda je vyžadována pozvánka)
create or replace function public.registration_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_users boolean;
begin
  select exists (
    select 1
    from public.attendance_profiles
    limit 1
  ) into v_has_users;

  return jsonb_build_object(
    'registration_enabled', true,
    'requires_invite', v_has_users
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
set search_path = public, extensions
as $$
declare
  v_code text;
  v_expires timestamptz;
  v_creator text;
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může generovat pozvánky.';
  end if;

  if p_target_role not in ('employee', 'admin', 'manager') then
    raise exception 'Neplatná role.';
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

-- Správce: reset PINu uživatele
create or replace function public.admin_reset_user_pin(
  p_target_user_key text,
  p_new_pin text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
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

  update public.attendance_profiles
  set pin_password_hash = v_bcrypt,
      pin_hash = null,
      auth_version = 2,
      failed_login_count = 0,
      locked_until = null,
      updated_at = now()
  where user_key = p_target_user_key;

  update public.attendance_sessions
  set revoked_at = now()
  where user_key = p_target_user_key and revoked_at is null;

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
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může měnit role.';
  end if;

  if p_new_role not in ('admin', 'employee', 'manager') then
    raise exception 'Neplatná role.';
  end if;

  update public.attendance_profiles
  set role = p_new_role,
      updated_at = now()
  where user_key = p_target_user_key;

  return true;
end;
$$;

-- Správce: smazání uživatele
create or replace function public.admin_delete_user(
  p_target_user_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může mazat uživatele.';
  end if;

  if p_target_user_key = public.current_session_user_key() then
    raise exception 'Nemůžeš smazat svůj vlastní přihlášený administrátorský účet.';
  end if;

  delete from public.attendance_profiles
  where user_key = p_target_user_key;

  return true;
end;
$$;

-- Atomický Last-Write-Wins (LWW) upsert dnů docházky s autorizací přes session token
create or replace function public.upsert_attendance_day_lww(
  p_day jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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
-- 8. ZABEZPEČENÍ ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
alter table public.attendance_profiles enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_invites enable row level security;
alter table public.attendance_days enable row level security;

-- PROFILY
drop policy if exists "Secure access to own profile" on public.attendance_profiles;
create policy "Secure access to own profile"
  on public.attendance_profiles
  for select
  to anon, authenticated
  using (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  );

drop policy if exists "Secure update own profile or admin" on public.attendance_profiles;
create policy "Secure update own profile or admin"
  on public.attendance_profiles
  for update
  to anon, authenticated
  using (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  )
  with check (
    (
      public.current_session_user_key() <> ''
      and user_key = public.current_session_user_key()
      and role = (select p.role from public.attendance_profiles p where p.user_key = public.current_session_user_key())
    )
    or public.is_admin()
  );

drop policy if exists "Secure delete profile admin only" on public.attendance_profiles;
create policy "Secure delete profile admin only"
  on public.attendance_profiles
  for delete
  to anon, authenticated
  using (public.is_admin());

-- RELACE (SESSIONS)
drop policy if exists "Users manage own sessions" on public.attendance_sessions;
create policy "Users manage own sessions"
  on public.attendance_sessions
  for all
  to anon, authenticated
  using (
    public.current_session_user_key() <> ''
    and user_key = public.current_session_user_key()
  )
  with check (
    public.current_session_user_key() <> ''
    and user_key = public.current_session_user_key()
  );

-- POZVÁNKY
drop policy if exists "Allow verify invite code" on public.attendance_invites;
drop policy if exists "Admin manage invites" on public.attendance_invites;
create policy "Admin manage invites"
  on public.attendance_invites
  for all
  to anon, authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DNY DOCHÁZKY
drop policy if exists "Secure access to own attendance days" on public.attendance_days;
create policy "Secure access to own attendance days"
  on public.attendance_days
  for select
  to anon, authenticated
  using (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  );

drop policy if exists "Secure write own attendance days" on public.attendance_days;
create policy "Secure write own attendance days"
  on public.attendance_days
  for insert
  to anon, authenticated
  with check (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  );

drop policy if exists "Secure update own attendance days" on public.attendance_days;
create policy "Secure update own attendance days"
  on public.attendance_days
  for update
  to anon, authenticated
  using (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  )
  with check (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  );

drop policy if exists "Secure delete own attendance days" on public.attendance_days;
create policy "Secure delete own attendance days"
  on public.attendance_days
  for delete
  to anon, authenticated
  using (
    (public.current_session_user_key() <> '' and user_key = public.current_session_user_key())
    or public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 9. OPRÁVNĚNÍ K FUNKCÍM A TABULKÁM
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant all on public.attendance_profiles to anon, authenticated;
grant all on public.attendance_sessions to anon, authenticated;
grant all on public.attendance_invites to anon, authenticated;
grant all on public.attendance_days to anon, authenticated;

grant execute on function public.current_session_token() to anon, authenticated;
grant execute on function public.current_session_user_key() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.login_attendance_user(text, text, boolean) to anon, authenticated;
grant execute on function public.logout_attendance_session(boolean) to anon, authenticated;
grant execute on function public.verify_attendance_session() to anon, authenticated;
grant execute on function public.change_attendance_pin(text, text, boolean) to anon, authenticated;
grant execute on function public.register_user_with_invite(text, text, text, text) to anon, authenticated;
grant execute on function public.registration_status() to anon, authenticated;
grant execute on function public.admin_create_invite(text) to anon, authenticated;
grant execute on function public.admin_reset_user_pin(text, text) to anon, authenticated;
grant execute on function public.admin_change_user_role(text, text) to anon, authenticated;
grant execute on function public.admin_delete_user(text) to anon, authenticated;
grant execute on function public.upsert_attendance_day_lww(jsonb) to anon, authenticated;
