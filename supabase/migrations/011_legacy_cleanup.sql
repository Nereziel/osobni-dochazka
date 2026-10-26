-- ============================================================================
-- 011_legacy_cleanup.sql
-- Registrace s bcrypt PINem, vystavením session a bezpečný úklid legacy objektů
--
-- 1. Aktualizace register_user_with_invite:
--    - Přijímá čistý PIN, který serverově zahashuje přes bcrypt
--    - Validuje kód pozvánky před zjišťováním existence uživatelského jména
--    - Přímo vystavuje 256-bitový session token (uživatel je po registraci rovnou přihlášen)
-- 2. Odstranění nepotřebných legacy a Supabase Auth funkcí:
--    - link_auth_account (Supabase Auth se nepoužívá)
--    - current_profile_user_key, req_user_key, req_pin_hash (nahrazeno session tokenem)
-- 3. Sloupec auth_id v attendance_profiles zůstává zachován jako deprecated (bezpečný nedestruktivní přístup)
-- ============================================================================

-- 1. Bezpečná registrace s přímým bcrypt hashem a vystavením session tokenu
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
    -- První profil je automaticky administrátor
    v_assigned_role := 'admin';
  else
    -- Prevence username enumeration: nejprve validujeme invite kód
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

  -- Až po úspěšném ověření invite kódu (nebo bootstrapu) ověřit unikátnost uživatelského jména
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

  -- Založení session tokenu pro okamžité přihlášení
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

grant execute on function public.register_user_with_invite(text, text, text, text) to anon, authenticated;

-- 2. Bezpečné odstranění zastaralých funkcí
drop function if exists public.link_auth_account(text, text);
drop function if exists public.current_profile_user_key();
drop function if exists public.req_user_key();
drop function if exists public.req_pin_hash();

-- Označení auth_id jako deprecated (sloupec v tabulce zůstává, aby nedošlo k chybám aplikovaných migrací)
comment on column public.attendance_profiles.auth_id is 'DEPRECATED: Supabase Auth se nepoužívá. Autentizace probíhá přes attendance_sessions.';

-- 3. Finální oprávnění pro anon a authenticated
grant usage on schema public to anon, authenticated;
grant all on public.attendance_profiles to anon, authenticated;
grant all on public.attendance_sessions to anon, authenticated;
grant all on public.attendance_invites to anon, authenticated;
grant all on public.attendance_days to anon, authenticated;

