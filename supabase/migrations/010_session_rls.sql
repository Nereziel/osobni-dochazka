-- ============================================================================
-- 010_session_rls.sql
-- Převod všech RLS politik a RPC procedur na ověřování výhradně přes session token
--
-- 1. RLS na attendance_sessions: uživatel vidí a spravuje pouze své vlastní relace
-- 2. RLS na attendance_days: čtení a zápis vlastních dat podle current_session_user_key()
-- 3. RLS na attendance_profiles: ochrana profilů a zákaz neoprávněné změny rolí
-- 4. RLS na attendance_invites: správa pozvánek výhradně pro ověřeného administrátora
-- 5. Atomická RPC upsert_attendance_day_lww: autorizace přes session token
-- 6. Administrátorské RPC funkce (pozvánky, správa profilů, reset PINu)
-- ============================================================================

-- 1. RLS pro novou tabulku attendance_sessions
alter table public.attendance_sessions enable row level security;

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

-- 2. RLS pro attendance_days přes session token
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

-- 3. RLS pro attendance_profiles přes session token
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

-- 4. RLS pro attendance_invites (výhradně admin)
drop policy if exists "Allow verify invite code" on public.attendance_invites;
drop policy if exists "Admin manage invites" on public.attendance_invites;
create policy "Admin manage invites"
  on public.attendance_invites
  for all
  to anon, authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5. RPC upsert_attendance_day_lww s autorizací přes session token
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
  -- 1. Ověření identity volajícího výhradně ze session tokenu
  v_caller_user_key := public.current_session_user_key();
  if coalesce(v_caller_user_key, '') = '' then
    raise exception 'Neautorizovaný přístup: Neplatná nebo expirovaná session.';
  end if;

  -- 2. Ověření cílového uživatele (běžný uživatel smí editovat pouze své dny, administrátor má výjimku)
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

  -- 3. Skutečně atomický INSERT ON CONFLICT DO UPDATE
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

  -- 4. Vyhodnocení výsledku
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

grant execute on function public.upsert_attendance_day_lww(jsonb) to anon, authenticated;

-- 6. Administrátorské RPC funkce
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

grant execute on function public.admin_create_invite(text) to anon, authenticated;

create or replace function public.admin_delete_user(
  p_target_user_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
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

grant execute on function public.admin_delete_user(text) to anon, authenticated;

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

  -- Revokovat aktivní relace dotčeného uživatele
  update public.attendance_sessions
  set revoked_at = now()
  where user_key = p_target_user_key and revoked_at is null;

  return true;
end;
$$;

grant execute on function public.admin_reset_user_pin(text, text) to anon, authenticated;

