-- OSOBNI DOCHAZKA: narrow the Data API surface (2026-11-27).
-- Apply after 20261102_admin_audit_read. No attendance rows are modified.
-- The same file is used for fresh databases, CI and existing installations.
begin;

-- These helpers are only used inside SECURITY DEFINER functions.
alter function public.current_client_user_agent() set search_path = pg_catalog;
alter function public.current_session_token() set search_path = pg_catalog;
revoke all on function public.current_client_user_agent() from public, anon, authenticated;
revoke all on function public.current_session_token() from public, anon, authenticated;

-- Maintenance is operator-only; the app does not expose tombstone purging.
revoke all on function public.admin_cleanup_old_tombstones(integer) from public, anon, authenticated;

-- Some installations retain an obsolete overload. Do not drop it or assume it exists.
do $$
begin
  if to_regprocedure('public.upsert_attendance_day_lww(text,text,text,text,text,integer,integer,timestamp with time zone,timestamp with time zone)') is not null then
    execute 'revoke all on function public.upsert_attendance_day_lww(text,text,text,text,text,integer,integer,timestamptz,timestamptz) from public, anon, authenticated';
  end if;
  -- Managed Supabase installs may have this event-trigger helper; keep its trigger intact.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- The team UI reads summaries, but does not edit someone else's attendance.
-- Keep the existing validated JSON contract and LWW semantics.
create or replace function public.upsert_attendance_day_lww(p_day jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller_user_key text;
  v_target_user_key text;
  v_date date;
  v_incoming_updated_at timestamptz;
  v_incoming_deleted_at timestamptz;
  v_metrics jsonb;
  v_result_row public.attendance_days%rowtype;
  v_existing_server public.attendance_days%rowtype;
begin
  v_caller_user_key := public.current_session_user_key();
  if coalesce(v_caller_user_key, '') = '' then
    raise exception 'Neautorizovaný přístup: Neplatná nebo expirovaná session.';
  end if;

  v_target_user_key := p_day->>'user_key';
  if v_target_user_key is distinct from v_caller_user_key then
    raise exception 'Přístup odepřen: Nelze upravovat data jiného uživatele.';
  end if;

  v_date := (p_day->>'date')::date;
  if v_date is null then
    raise exception 'Chybí povinný atribut date.';
  end if;

  v_incoming_updated_at := least(coalesce((p_day->>'updated_at')::timestamptz, now()), now());
  if p_day->>'deleted_at' is not null then
    v_incoming_deleted_at := least((p_day->>'deleted_at')::timestamptz, now());
  else
    v_incoming_deleted_at := null;
  end if;

  v_metrics := public.attendance_compute_day_metrics(p_day, v_target_user_key);

  insert into public.attendance_days as d(
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
    v_incoming_deleted_at,
    v_incoming_updated_at
  )
  on conflict(user_key, date)
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
      'action', case when v_incoming_deleted_at is not null then 'tombstone' else 'upsert' end,
      'date', v_date,
      'server_updated_at', v_result_row.updated_at,
      'worked_minutes', v_result_row.worked_minutes,
      'credited_minutes', v_result_row.credited_minutes,
      'target_minutes', v_result_row.target_minutes,
      'balance_minutes', v_result_row.balance_minutes,
      'break_minutes', v_result_row.break_minutes
    );
  end if;

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
end;
$$;

-- Explicitly preserve access to the current application RPC and the RLS helpers.
revoke all on function public.upsert_attendance_day_lww(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_attendance_day_lww(jsonb) to anon, authenticated;

commit;
