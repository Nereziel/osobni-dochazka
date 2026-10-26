-- ============================================================================
-- 001_security_fix.sql
-- Bezpečnostní opravy pro Osobní docházku
-- 
-- 1. Oprava Privilege Escalation: Běžný uživatel si nesmí měnit roli na admina.
-- 2. Oprava úniku pozvánek: Odstranění veřejného SELECTu z attendance_invites.
-- 3. Zabezpečené RPC pro ověření pozvánky bez úniku celé tabulky.
-- 4. Zvýšení entropie a expirace pozvánek (128+ bitů).
-- 5. Oprava v_monthly_attendance_summary s security_invoker = true.
-- 6. Omezení grant all a doplnění SET search_path = public u security definer funkcí.
-- ============================================================================

-- 1. Doplnění sloupců pro expiraci a audit u pozvánek (pokud ještě neexistují)
alter table public.attendance_invites
  add column if not exists expires_at timestamptz default (now() + interval '14 days');

-- 2. Oprava RLS politiky pro aktualizaci profilu (zákaz změny role běžným uživatelem)
drop policy if exists "Secure update own profile or admin" on public.attendance_profiles;
create policy "Secure update own profile or admin"
  on public.attendance_profiles
  for update
  to anon, authenticated
  using (
    (user_key = public.req_user_key() and pin_hash = public.req_pin_hash())
    or public.is_admin()
  )
  with check (
    -- Běžný uživatel smí editovat jen svůj profil a nesmí si změnit roli na admin/manager
    (
      user_key = public.req_user_key()
      and role = (select p.role from public.attendance_profiles p where p.user_key = public.req_user_key())
    )
    or public.is_admin()
  );

-- 3. Oprava úniku pozvánek: Zrušení veřejného SELECTu z attendance_invites
drop policy if exists "Allow verify invite code" on public.attendance_invites;

-- Pouze admin smí číst a spravovat celou tabulku pozvánek
drop policy if exists "Admin manage invites" on public.attendance_invites;
create policy "Admin manage invites"
  on public.attendance_invites
  for all
  to anon, authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4. Bezpečná RPC funkce pro ověření platnosti kódu pozvánky (pro registraci bez úniku všech kódů)
create or replace function public.verify_invite_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invite public.attendance_invites%rowtype;
begin
  if coalesce(trim(p_code), '') = '' then
    return jsonb_build_object('valid', false, 'reason', 'Kód nebyl zadán.');
  end if;

  select * into v_invite
  from public.attendance_invites
  where upper(code) = upper(trim(p_code));

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'Kód pozvánky neexistuje.');
  end if;

  if v_invite.is_used then
    return jsonb_build_object('valid', false, 'reason', 'Tento kód pozvánky již byl využit.');
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'Platnost této pozvánky již vypršela.');
  end if;

  return jsonb_build_object(
    'valid', true,
    'target_role', coalesce(v_invite.target_role, 'employee')
  );
end;
$$;

-- 5. Bezpečné generování pozvánek s vysokou entropií (128+ bitů)
create or replace function public.admin_create_invite(
  p_target_role text default 'employee'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_expires timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může generovat pozvánky.';
  end if;

  if p_target_role not in ('employee', 'admin', 'manager') then
    raise exception 'Neplatná role.';
  end if;

  -- 128 bitů náhodných dat vygenerovaných pomocí pgcrypto gen_random_bytes
  v_code := 'INV-' || upper(encode(gen_random_bytes(16), 'hex'));
  v_expires := now() + interval '14 days';

  insert into public.attendance_invites (
    code,
    created_by,
    target_role,
    expires_at
  ) values (
    v_code,
    public.req_user_key(),
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

-- 6. Oprava bezpečnostního kontextu u ostatních SECURITY DEFINER funkcí
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_profiles
    where user_key = public.req_user_key()
      and pin_hash = public.req_pin_hash()
      and (
        role = 'admin'
        or not exists (select 1 from public.attendance_profiles where role = 'admin')
      )
  );
$$;

create or replace function public.admin_reset_user_pin(
  p_target_user_key text,
  p_new_pin_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může resetovat PIN.';
  end if;

  update public.attendance_profiles
  set pin_hash = p_new_pin_hash,
      updated_at = now()
  where user_key = p_target_user_key;

  return true;
end;
$$;

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

  if p_target_user_key = public.req_user_key() then
    raise exception 'Nemůžeš smazat svůj vlastní přihlášený administrátorský účet.';
  end if;

  delete from public.attendance_profiles
  where user_key = p_target_user_key;

  return true;
end;
$$;

create or replace function public.register_user_with_invite(
  p_username text,
  p_display_name text,
  p_pin_hash text,
  p_invite_code text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_count integer;
  v_clean_user text;
  v_user_key text;
  v_invite public.attendance_invites%rowtype;
  v_assigned_role text := 'employee';
begin
  v_clean_user := lower(trim(regexp_replace(p_username, '[^a-zA-Z0-9._-]', '', 'g')));
  if length(v_clean_user) < 3 then
    raise exception 'Uživatelské jméno musí mít alespoň 3 znaky.';
  end if;
  v_user_key := 'user:' || v_clean_user;

  if exists (select 1 from public.attendance_profiles where user_key = v_user_key) then
    raise exception 'Uživatelské jméno "%" je již obsazeno.', v_clean_user;
  end if;

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

  insert into public.attendance_profiles (
    user_key,
    username,
    display_name,
    pin_hash,
    role
  ) values (
    v_user_key,
    v_clean_user,
    coalesce(nullif(trim(p_display_name), ''), v_clean_user),
    p_pin_hash,
    v_assigned_role
  );

  if v_user_count > 0 and v_invite.code is not null then
    update public.attendance_invites
    set is_used = true,
        used_by = v_user_key,
        used_at = now()
    where code = v_invite.code;
  end if;

  return jsonb_build_object(
    'success', true,
    'user_key', v_user_key,
    'username', v_clean_user,
    'display_name', coalesce(nullif(trim(p_display_name), ''), v_clean_user),
    'role', v_assigned_role
  );
end;
$$;

-- 7. Oprava view v_monthly_attendance_summary: použít security_invoker = true
drop view if exists public.v_monthly_attendance_summary cascade;
create or replace view public.v_monthly_attendance_summary
with (security_invoker = true)
as
select
  d.user_key,
  p.username,
  p.display_name,
  p.role,
  to_char(d.date, 'YYYY-MM') as month,
  count(*) as recorded_days,
  sum(d.worked_minutes) as total_worked_minutes,
  sum(d.credited_minutes) as total_credited_minutes,
  sum(d.target_minutes) as total_target_minutes,
  sum(d.balance_minutes) as total_balance_minutes,
  count(*) filter (where d.type = 'vacation') + (count(*) filter (where d.type = 'halfVacation') * 0.5) as vacation_days_used
from public.attendance_days d
join public.attendance_profiles p on p.user_key = d.user_key
group by d.user_key, p.username, p.display_name, p.role, to_char(d.date, 'YYYY-MM');

-- 8. Omezení grantů podle principu nejmenších oprávnění
revoke all on public.attendance_profiles from anon, authenticated;
revoke all on public.attendance_invites from anon, authenticated;
revoke all on public.attendance_days from anon, authenticated;

grant select, update on public.attendance_profiles to anon, authenticated;
grant select on public.attendance_invites to anon, authenticated;
grant select, insert, update, delete on public.attendance_days to anon, authenticated;
grant select on public.v_monthly_attendance_summary to anon, authenticated;

grant execute on function public.verify_invite_code(text) to anon, authenticated;
grant execute on function public.register_user_with_invite(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_create_invite(text) to anon, authenticated;
grant execute on function public.admin_reset_user_pin(text, text) to anon, authenticated;
grant execute on function public.admin_change_user_role(text, text) to anon, authenticated;
grant execute on function public.admin_delete_user(text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.req_user_key() to anon, authenticated;
grant execute on function public.req_pin_hash() to anon, authenticated;

