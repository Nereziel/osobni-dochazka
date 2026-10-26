-- ============================================================================
-- 009_custom_sessions.sql
-- Vlastní bezpečný session systém a bcrypt hashování PINu
--
-- 1. Povolení rozšíření pgcrypto (gen_random_bytes, digest, crypt, gen_salt)
-- 2. Rozšíření attendance_profiles o bcrypt hash, auth_version a lockout sloupce
-- 3. Vytvoření tabulky attendance_sessions pro uložení SHA-256 hashů session tokenů
-- 4. Session helpery current_session_token(), current_session_user_key() a is_admin()
-- 5. Session RPC: login_attendance_user, logout_attendance_session, verify_attendance_session
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Doplnění sloupců pro nový auth systém do attendance_profiles
alter table public.attendance_profiles
  add column if not exists pin_password_hash text,
  add column if not exists auth_version integer not null default 1,
  add column if not exists failed_login_count integer not null default 0,
  add column if not exists locked_until timestamptz default null,
  add column if not exists last_failed_login_at timestamptz default null,
  add column if not exists legacy_migrated_at timestamptz default null;

-- 2. Tabulka pro ukládání session
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

-- 3. Získání RAW session tokenu z HTTP hlavičky X-Attendance-Session
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

grant execute on function public.current_session_token() to anon, authenticated;

-- 4. Získání a ověření přihlášeného user_key ze session tokenu
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

grant execute on function public.current_session_user_key() to anon, authenticated;

-- 5. Funkce ověřující, zda je přihlášený uživatel správce
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

grant execute on function public.is_admin() to anon, authenticated;

-- 6. Login RPC: ověření PINu (bcrypt / seamless legacy migration), ochrana brute-force a vystavení tokenu
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

  -- Kontrola dočasného uzamčení účtu po neúspěšných pokusech (ochrana proti brute force)
  if v_profile.locked_until is not null and v_profile.locked_until > now() then
    raise exception 'Účet je dočasně uzamčen z bezpečnostních důvodů. Zkuste to za chvíli.';
  end if;

  -- Ověření hesla podle verze autentizace
  if v_profile.auth_version = 2 and v_profile.pin_password_hash is not null then
    -- Nový standard: bcrypt ověření
    v_is_valid := (crypt(p_pin, v_profile.pin_password_hash) = v_profile.pin_password_hash);
  elsif v_profile.auth_version = 1 and v_profile.pin_hash is not null then
    -- Plynulá jednorázová migrace stávajícího uživatele:
    -- Spočteme původní SHA-256 hash zadaného PINu
    v_legacy_hash := encode(digest('dochazka:' || v_clean_user || ':' || p_pin, 'sha256'), 'hex');
    if v_legacy_hash = v_profile.pin_hash then
      v_is_valid := true;
      -- Automatické okamžité povýšení na bcrypt bez nutnosti zásahu uživatele
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
    -- Zvýšení čítače neúspěšných pokusů a případné dočasné zamčení
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

  -- Úspěšné přihlášení: vynulovat neúspěšné pokusy
  update public.attendance_profiles
  set failed_login_count = 0,
      locked_until = null
  where user_key = v_profile.user_key;

  -- Generování kryptograficky silného 256-bitového session tokenu
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

grant execute on function public.login_attendance_user(text, text, boolean) to anon, authenticated;

-- 7. Logout RPC: serverové zneplatnění (revokace) session
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

grant execute on function public.logout_attendance_session(boolean) to anon, authenticated;

-- 8. Ověření platnosti session při startu PWA
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

grant execute on function public.verify_attendance_session() to anon, authenticated;

-- 9. Změna PINu přihlášeným uživatelem
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

grant execute on function public.change_attendance_pin(text, text, boolean) to anon, authenticated;

