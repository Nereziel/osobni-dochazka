-- Read-only recalculation using the current schedule, not historical settings.
-- No stored attendance rows are changed.
begin;

create or replace function public.attendance_metrics_for_schedule(
  p_day jsonb, p_work_days integer[], p_work_on_holidays boolean,
  p_weekend_custom_hours boolean, p_weekend_target_minutes integer,
  p_daily_target_minutes integer, p_break_after_minutes integer, p_break_minutes integer
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
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
  v_date := (p_day->>'date')::date;
  v_type := coalesce(p_day->>'type', 'work');
  v_dow := extract(dow from v_date)::integer;

  v_scheduled := v_dow = any(case when coalesce(cardinality(p_work_days), 0) = 0 then array[1,2,3,4,5] else p_work_days end)
    and (p_work_on_holidays or not public.attendance_is_czech_holiday(v_date));

  if v_type <> 'holiday' and v_scheduled then
    if v_dow in (0, 6) and p_weekend_custom_hours then
      v_target := p_weekend_target_minutes;
    else
      v_target := p_daily_target_minutes;
    end if;
  end if;

  v_allows_work := v_type in ('work','homeOffice','businessTrip','halfVacation','doctor','other');
  v_manual_break := coalesce((p_day->>'manual_break')::boolean, false);
  v_doctor_full := coalesce((p_day->>'doctor_full_day')::boolean, false);
  v_presence := public.attendance_duration_minutes(p_day->>'start_time', p_day->>'end_time');

  if v_allows_work and v_presence > 0 then
    if v_manual_break then
      v_break := least(v_presence, greatest(0, coalesce((p_day->>'break_minutes')::integer, 0)));
    elsif v_presence >= p_break_after_minutes then
      v_break := least(v_presence, greatest(0, p_break_minutes));
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

-- These functions are pure calculations on supplied values; no table access.
grant execute on function public.attendance_time_to_minutes(text),
  public.attendance_duration_minutes(text, text),
  public.attendance_overlap_minutes(text, text, text, text),
  public.attendance_is_czech_holiday(date) to anon, authenticated;
revoke all on function public.attendance_metrics_for_schedule(jsonb, integer[], boolean, boolean, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.attendance_metrics_for_schedule(jsonb, integer[], boolean, boolean, integer, integer, integer, integer) to anon, authenticated;

-- Keep the existing internal RPC contract, using the same shared formula.
create or replace function public.attendance_compute_day_metrics(p_day jsonb, p_user_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  p public.attendance_profiles%rowtype;
begin
  select * into p from public.attendance_profiles where user_key = p_user_key;
  if not found then raise exception 'Uživatelský profil nebyl nalezen.'; end if;
  return public.attendance_metrics_for_schedule(p_day, p.work_days, p.work_on_holidays, p.weekend_custom_hours, p.weekend_target_minutes, p.daily_target_minutes, p.break_after_minutes, p.break_minutes);
end;
$$;
revoke all on function public.attendance_compute_day_metrics(jsonb,text) from public, anon, authenticated;

-- Match the JS completion predicate; absence-only doctor/other records can be closed.
create or replace function public.attendance_day_is_complete(p_day jsonb, p_today date)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
  select (p_day->>'deleted_at') is null and (p_day->>'date')::date <= p_today and
    case
      when p_day->>'type' not in ('work','homeOffice','businessTrip','halfVacation','doctor','other') then true
      when p_day->>'type' = 'doctor' and coalesce((p_day->>'doctor_full_day')::boolean,false) then true
      when coalesce(p_day->>'start_time','') = '' and coalesce(p_day->>'end_time','') = '' and p_day->>'type' = 'doctor'
        then public.attendance_duration_minutes(p_day->>'doctor_start',p_day->>'doctor_end') > 0
      when coalesce(p_day->>'start_time','') = '' and coalesce(p_day->>'end_time','') = '' and p_day->>'type' = 'other'
        then coalesce((p_day->>'other_minutes')::integer,0) > 0
      else public.attendance_time_to_minutes(p_day->>'start_time') is not null
        and public.attendance_time_to_minutes(p_day->>'end_time') is not null
    end;
$$;
revoke all on function public.attendance_day_is_complete(jsonb,date) from public, anon, authenticated;
grant execute on function public.attendance_day_is_complete(jsonb,date) to anon, authenticated;

-- Existing columns retain their names and types for older deployed clients.
-- RLS on both underlying tables still applies as the querying REST role.
create or replace view public.v_monthly_attendance_summary
with (security_invoker = true)
as
select
  d.user_key, p.username, p.display_name, to_char(d.date, 'YYYY-MM') as month,
  count(d.date) filter (where d.deleted_at is null) as total_days_recorded,
  sum((m.metrics->>'worked_minutes')::integer) filter (where c.closed) as total_worked_minutes,
  sum((m.metrics->>'credited_minutes')::integer) filter (where c.closed) as total_credited_minutes,
  sum((m.metrics->>'target_minutes')::integer) filter (where c.closed) as total_target_minutes,
  sum((m.metrics->>'balance_minutes')::integer) filter (where c.closed) as total_balance_minutes,
  count(d.date) filter (where d.type in ('vacation','halfVacation') and d.deleted_at is null and (m.metrics->>'target_minutes')::integer > 0) as vacation_days_count,
  count(d.date) filter (where d.type = 'doctor' and d.deleted_at is null) as doctor_days_count,
  count(d.date) filter (where d.type = 'sick' and d.deleted_at is null) as sick_days_count,
  max(d.updated_at) as last_updated_at,
  coalesce(sum(case when d.type = 'halfVacation' then 0.5 else 1.0 end)
    filter (where d.type in ('vacation','halfVacation') and d.deleted_at is null and (m.metrics->>'target_minutes')::integer > 0),0) as vacation_days_used
from public.attendance_days d
join public.attendance_profiles p on p.user_key = d.user_key
cross join lateral (select public.attendance_metrics_for_schedule(to_jsonb(d), p.work_days, p.work_on_holidays,
  p.weekend_custom_hours, p.weekend_target_minutes, p.daily_target_minutes, p.break_after_minutes, p.break_minutes) as metrics) m
cross join lateral (select public.attendance_day_is_complete(to_jsonb(d), (now() at time zone 'Europe/Prague')::date) as closed) c
group by d.user_key, p.username, p.display_name, to_char(d.date, 'YYYY-MM');

grant select on public.v_monthly_attendance_summary to anon, authenticated;
revoke insert, update, delete on public.v_monthly_attendance_summary from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
