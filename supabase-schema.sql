-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – DATABÁZE PRO SUPABASE (PostgreSQL)
-- ============================================================================
-- Jedna společná Supabase databáze pro všechny uživatele aplikace.
-- Obsahuje přísné zabezpečení Row Level Security (RLS), které na straně
-- databáze ověřuje uživatelské jméno i zahashovaný PIN v hlavičce požadavku.
-- Díky tomu je použití veřejného Supabase "anon" klíče na GitHub Pages bezpečné
-- a nikdo nemůže číst ani měnit cizí docházku.
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

create index if not exists idx_attendance_profiles_username
  on public.attendance_profiles (lower(username));

-- ----------------------------------------------------------------------------
-- 2. DENNÍ ZÁZNAMY DOCHÁZKY (attendance_days)
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
-- 3. AUTOMATICKÁ AKTUALIZACE updated_at
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
-- 4. PŘEHLEDOVÝ POHLED (VIEW) PRO MĚSÍČNÍ SOUHRNY PO UŽIVATELÍCH
-- ----------------------------------------------------------------------------
create or replace view public.v_monthly_attendance_summary as
select
  d.user_key,
  p.username,
  p.display_name,
  to_char(d.date, 'YYYY-MM') as month,
  count(*) as recorded_days,
  sum(d.worked_minutes) as total_worked_minutes,
  sum(d.credited_minutes) as total_credited_minutes,
  sum(d.target_minutes) as total_target_minutes,
  sum(d.balance_minutes) as total_balance_minutes,
  count(*) filter (where d.type = 'vacation') + (count(*) filter (where d.type = 'halfVacation') * 0.5) as vacation_days_used
from public.attendance_days d
join public.attendance_profiles p on p.user_key = d.user_key
group by d.user_key, p.username, p.display_name, to_char(d.date, 'YYYY-MM');

-- ----------------------------------------------------------------------------
-- 5. ZABEZPEČENÍ ROW LEVEL SECURITY (OVĚŘENÍ UŽIVATELE A PINU NA SERVERU)
-- Pomocné funkce čtou user_key a pin_hash z hlavičky X-Client-Info.
-- Nikdo nemůže číst ani upravovat záznamy jiného uživatele bez znalosti PINu.
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

alter table public.attendance_profiles enable row level security;
alter table public.attendance_days enable row level security;

drop policy if exists "Allow public access to profiles" on public.attendance_profiles;
drop policy if exists "Secure access to own profile" on public.attendance_profiles;
create policy "Secure access to own profile"
  on public.attendance_profiles
  for all
  to anon, authenticated
  using (
    user_key = public.req_user_key()
    and pin_hash = public.req_pin_hash()
  )
  with check (
    user_key = public.req_user_key()
    and pin_hash = public.req_pin_hash()
  );

drop policy if exists "Allow public access to attendance days" on public.attendance_days;
drop policy if exists "Secure access to own attendance days" on public.attendance_days;
create policy "Secure access to own attendance days"
  on public.attendance_days
  for all
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
