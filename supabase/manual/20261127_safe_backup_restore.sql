-- Atomic insert-only backup restore. Apply after the RPC least-privilege bundle.
begin;
create or replace function public.restore_attendance_day_if_missing(p_day jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller_user_key text;
  v_target_user_key text;
  v_date date;
  v_metrics jsonb;
  v_result_row public.attendance_days%rowtype;
begin
  v_caller_user_key := public.current_session_user_key();
  if coalesce(v_caller_user_key, '') = '' then
    raise exception 'Neautorizovaný přístup.';
  end if;
  if p_day is null or p_day = 'null'::jsonb then
    return jsonb_build_object('supported', true, 'user_key', v_caller_user_key);
  end if;
  v_target_user_key := p_day->>'user_key';
  if v_target_user_key is distinct from v_caller_user_key or p_day->>'deleted_at' is not null then
    raise exception 'Nepovolený import.';
  end if;
  v_date := (p_day->>'date')::date;
  if v_date is null then raise exception 'Chybí datum.'; end if;
  v_metrics := public.attendance_compute_day_metrics(p_day, v_target_user_key);
  insert into public.attendance_days (
    user_key, date, type, start_time, end_time, manual_break, break_minutes,
    doctor_full_day, doctor_start, doctor_end, other_minutes,
    worked_minutes, credited_minutes, target_minutes, balance_minutes,
    note, deleted_at, updated_at
  ) values (
    v_target_user_key,
    v_date,
    coalesce(p_day->>'type', 'work'),
    coalesce(p_day->>'start_time', ''),
    coalesce(p_day->>'end_time', ''),
    coalesce((p_day->>'manual_break')::boolean, false),
    (v_metrics->>'break_minutes')::integer,
    coalesce((p_day->>'doctor_full_day')::boolean, false),
    coalesce(p_day->>'doctor_start', ''),
    coalesce(p_day->>'doctor_end', ''),
    coalesce((p_day->>'other_minutes')::integer, 0),
    (v_metrics->>'worked_minutes')::integer,
    (v_metrics->>'credited_minutes')::integer,
    (v_metrics->>'target_minutes')::integer,
    (v_metrics->>'balance_minutes')::integer,
    coalesce(p_day->>'note', ''),
    null,
    now()
  )
  on conflict (user_key, date) do nothing
  returning * into v_result_row;
  if found then
    return jsonb_build_object('applied', true, 'date', v_date, 'server_updated_at', v_result_row.updated_at);
  end if;
  return jsonb_build_object('applied', false, 'reason', 'server_exists', 'date', v_date);
end;
$$;
revoke all on function public.restore_attendance_day_if_missing(jsonb) from public, anon, authenticated;
grant execute on function public.restore_attendance_day_if_missing(jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
