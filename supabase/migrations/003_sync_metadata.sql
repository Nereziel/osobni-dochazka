-- ============================================================================
-- 003_sync_metadata.sql
-- Metadata pro offline synchronizaci a spolehlivé mazání (Tombstones)
--
-- Tento skript:
-- 1. Přidá sloupec `deleted_at timestamptz` do `attendance_days` pro podporu
--    offline mazání bez rizika, že se smazaný den vrátí z jiného zařízení.
-- 2. Přidá index na `deleted_at` a `updated_at`.
-- 3. Upraví view měsíčního souhrnu tak, aby ignorovalo smazané dny.
-- ============================================================================

-- 1. Přidání sloupce deleted_at pro soft-delete / tombstones
alter table public.attendance_days
  add column if not exists deleted_at timestamptz default null;

create index if not exists idx_attendance_days_deleted_at
  on public.attendance_days (deleted_at)
  where deleted_at is not null;

create index if not exists idx_attendance_days_sync
  on public.attendance_days (user_key, updated_at desc);

-- 2. Aktualizace pohledu v_monthly_attendance_summary s vyloučením smazaných dnů
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
where d.deleted_at is null
group by d.user_key, p.username, p.display_name, p.role, to_char(d.date, 'YYYY-MM');

grant select on public.v_monthly_attendance_summary to anon, authenticated;

