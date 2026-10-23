-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – DATABÁZE PRO SUPABASE (PostgreSQL)
-- ============================================================================
-- Jedna společná Supabase databáze pro všechny uživatele aplikace.
-- Obsahuje zabezpečení Row Level Security (RLS) a Invite-Only registrační systém:
--
-- 1. INVITE-ONLY REGISTRACE:
--    - První registrovaný uživatel se automaticky stává Správcem (admin) bez pozvánky.
--    - Každý další uživatel se může registrovat pouze s platným kódem pozvánky,
--      který vygeneroval správce.
--
-- 2. ROLE A SPRÁVA TÝMU:
--    - Role: 'admin' (Správce) nebo 'employee' (Zaměstnanec).
--    - Správce má v aplikaci přístup ke správě týmu, generování pozvánek,
--      resetování zapomenutých PINů a souhrnnému přehledu docházky celého týmu.
--
-- 3. ZABEZPEČENÍ POMOCÍ PIN HASH:
--    - Ověření probíhá na úrovni databáze přes hlavičku X-Client-Info: dochazka-pwa|<user_key>|<pin_hash>.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. UŽIVATELÉ A JEJICH NASTAVENÍ PRACOVNÍ DOBY (attendance_profiles)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_profiles (
  user_key text primary key,
  username text not null unique,
  display_name text not null default '',
  pin_hash text not null default '',
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

  -- Dovolená a vzhled
  vacation_allowance_days numeric(4,1) not null default 20.0,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),

  -- Doplňující JSON nastavení
  settings_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Zajištění sloupce role pro případ aktualizace již existující tabulky
alter table public.attendance_profiles 
  add column if not exists role text not null default 'employee' check (role in ('admin', 'manager', 'employee'));

-- Pokud již v databázi existují uživatelé, ale žádný z nich nemá roli 'admin',
-- automaticky povýšíme nejstaršího (prvního) uživatele na Správce ('admin'),
-- aby měl stávající vlastník po aplikaci SQL okamžitě přístup ke správě týmu.
update public.attendance_profiles
set role = 'admin'
where user_key in (
  select user_key from public.attendance_profiles order by created_at asc limit 1
) and not exists (
  select 1 from public.attendance_profiles where role = 'admin'
);

create index if not exists idx_attendance_profiles_username
  on public.attendance_profiles (lower(username));

create index if not exists idx_attendance_profiles_role
  on public.attendance_profiles (role);

-- ----------------------------------------------------------------------------
-- 2. SYSTÉM POZVÁNEK (attendance_invites)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_invites (
  code text primary key,
  created_by text references public.attendance_profiles(user_key) on delete set null,
  target_role text not null default 'employee' check (target_role in ('employee', 'manager', 'admin')),
  is_used boolean not null default false,
  used_by text references public.attendance_profiles(user_key) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_invites_code
  on public.attendance_invites (upper(code));

create index if not exists idx_attendance_invites_unused
  on public.attendance_invites (is_used, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. DENNÍ ZÁZNAMY DOCHÁZKY (attendance_days)
-- ----------------------------------------------------------------------------
create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
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
  break_minutes integer not null default 30,
  doctor_full_day boolean not null default false,
  doctor_start text not null default '',
  doctor_end text not null default '',
  other_minutes integer not null default 0,

  -- Spočtené minuty pro rychlé přehledy přímo v databázi
  worked_minutes integer not null default 0,
  credited_minutes integer not null default 0,
  target_minutes integer not null default 0,
  balance_minutes integer not null default 0,

  note text not null default '',
  updated_at timestamptz not null default now(),

  unique (user_key, date)
);

create index if not exists idx_attendance_days_user_date
  on public.attendance_days (user_key, date desc);

-- ----------------------------------------------------------------------------
-- 4. AUTOMATICKÁ AKTUALIZACE updated_at
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_attendance_profiles_updated_at on public.attendance_profiles;
create trigger trg_attendance_profiles_updated_at
before update on public.attendance_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_attendance_days_updated_at on public.attendance_days;
create trigger trg_attendance_days_updated_at
before update on public.attendance_days
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. PŘEHLEDOVÝ POHLED (VIEW) PRO MĚSÍČNÍ SOUHRNY PO UŽIVATELÍCH
-- ----------------------------------------------------------------------------
-- PostgreSQL nedovoluje měnit pořadí nebo názvy sloupců v existujícím view
-- pomocí pouhého CREATE OR REPLACE VIEW (vyvolává chybu 42P16).
-- DROP VIEW CASCADE smaže pouze virtuální pohled, NIKDY nesmaže data v tabulkách.
drop view if exists public.v_monthly_attendance_summary cascade;
create or replace view public.v_monthly_attendance_summary as
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

grant select on public.v_monthly_attendance_summary to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. POMOCNÉ AUTENTIZAČNÍ FUNKCE (Čtou identitu z X-Client-Info)
-- ----------------------------------------------------------------------------
create or replace function public.req_user_key()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(split_part(current_setting('request.headers', true)::json->>'x-client-info', '|', 2), ''),
    ''
  );
$$;

create or replace function public.req_pin_hash()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(split_part(current_setting('request.headers', true)::json->>'x-client-info', '|', 3), ''),
    ''
  );
$$;

-- Funkce ověřující, zda je aktuální volající správcem
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.attendance_profiles
    where user_key = public.req_user_key()
      and pin_hash = public.req_pin_hash()
      and role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- 7. RPC FUNKCE PRO REGISTRACI A SPRÁVU TÝMU
-- ----------------------------------------------------------------------------

-- Registrace s ověřením pozvánky (nebo automatický první správce)
create or replace function public.register_user_with_invite(
  p_username text,
  p_display_name text,
  p_pin_hash text,
  p_invite_code text default ''
)
returns jsonb
language plpgsql
security definer
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

  -- Pokud v databázi ještě nikdo není, první uživatel se stává hlavním správcem!
  if v_user_count = 0 then
    v_assigned_role := 'admin';
  else
    -- Databáze již uživatele má -> je vyžadována platná, nevyužitá pozvánka
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

-- Vytvoření nové pozvánky správcem
create or replace function public.admin_create_invite(
  p_target_role text default 'employee'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může generovat pozvánky.';
  end if;

  if p_target_role not in ('employee', 'admin', 'manager') then
    raise exception 'Neplatná role.';
  end if;

  -- Vygenerování přehledného 6-místného kódu (např. INV-8X2K9M)
  v_code := 'INV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.attendance_invites (
    code,
    created_by,
    target_role
  ) values (
    v_code,
    public.req_user_key(),
    p_target_role
  );

  return jsonb_build_object(
    'code', v_code,
    'target_role', p_target_role,
    'created_at', now()
  );
end;
$$;

-- Resetování PINu kolegy správcem
create or replace function public.admin_reset_user_pin(
  p_target_user_key text,
  p_new_pin_hash text
)
returns boolean
language plpgsql
security definer
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

-- Změna role uživatele správcem
create or replace function public.admin_change_user_role(
  p_target_user_key text,
  p_new_role text
)
returns boolean
language plpgsql
security definer
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

-- Smazání uživatele správcem
create or replace function public.admin_delete_user(
  p_target_user_key text
)
returns boolean
language plpgsql
security definer
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

-- ----------------------------------------------------------------------------
-- 8. ZABEZPEČENÍ ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
alter table public.attendance_profiles enable row level security;
alter table public.attendance_invites enable row level security;
alter table public.attendance_days enable row level security;

-- PROFILY: Uživatel má přístup ke svému profilu, Správce ke všem profilům
drop policy if exists "Secure access to own profile" on public.attendance_profiles;
create policy "Secure access to own profile"
  on public.attendance_profiles
  for select
  to anon, authenticated
  using (
    (user_key = public.req_user_key() and pin_hash = public.req_pin_hash())
    or public.is_admin()
  );

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
    user_key = public.req_user_key()
    or public.is_admin()
  );

drop policy if exists "Secure delete profile admin only" on public.attendance_profiles;
create policy "Secure delete profile admin only"
  on public.attendance_profiles
  for delete
  to anon, authenticated
  using (public.is_admin());

-- POZVÁNKY: Veřejné čtení pro ověření kódu před registrací, zápis pouze pro správce
drop policy if exists "Allow verify invite code" on public.attendance_invites;
create policy "Allow verify invite code"
  on public.attendance_invites
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Admin manage invites" on public.attendance_invites;
create policy "Admin manage invites"
  on public.attendance_invites
  for all
  to anon, authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DNY DOCHÁZKY: Uživatel má plná práva ke svým dnům, Správce má právo čtení celého týmu
drop policy if exists "Secure access to own attendance days" on public.attendance_days;
create policy "Secure access to own attendance days"
  on public.attendance_days
  for select
  to anon, authenticated
  using (
    user_key = public.req_user_key()
    or public.is_admin()
  );

drop policy if exists "Secure write own attendance days" on public.attendance_days;
create policy "Secure write own attendance days"
  on public.attendance_days
  for insert
  to anon, authenticated
  with check (
    user_key = public.req_user_key()
    and exists (
      select 1
      from public.attendance_profiles p
      where p.user_key = attendance_days.user_key
        and p.pin_hash = public.req_pin_hash()
    )
  );

drop policy if exists "Secure update own attendance days" on public.attendance_days;
create policy "Secure update own attendance days"
  on public.attendance_days
  for update
  to anon, authenticated
  using (
    user_key = public.req_user_key()
    and exists (
      select 1
      from public.attendance_profiles p
      where p.user_key = attendance_days.user_key
        and p.pin_hash = public.req_pin_hash()
    )
  )
  with check (
    user_key = public.req_user_key()
    and exists (
      select 1
      from public.attendance_profiles p
      where p.user_key = attendance_days.user_key
        and p.pin_hash = public.req_pin_hash()
    )
  );

drop policy if exists "Secure delete own attendance days" on public.attendance_days;
create policy "Secure delete own attendance days"
  on public.attendance_days
  for delete
  to anon, authenticated
  using (
    (user_key = public.req_user_key() and exists (
      select 1
      from public.attendance_profiles p
      where p.user_key = attendance_days.user_key
        and p.pin_hash = public.req_pin_hash()
    ))
    or public.is_admin()
  );

-- OPRÁVNĚNÍ K FUNKCÍM A TABULKÁM PRO ANONYMNÍ I PŘIHLÁŠENÉ SPOJENÍ
grant usage on schema public to anon, authenticated;
grant all on public.attendance_profiles to anon, authenticated;
grant all on public.attendance_invites to anon, authenticated;
grant all on public.attendance_days to anon, authenticated;
grant execute on function public.register_user_with_invite(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_create_invite(text) to anon, authenticated;
grant execute on function public.admin_reset_user_pin(text, text) to anon, authenticated;
grant execute on function public.admin_change_user_role(text, text) to anon, authenticated;
grant execute on function public.admin_delete_user(text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.req_user_key() to anon, authenticated;
grant execute on function public.req_pin_hash() to anon, authenticated;

