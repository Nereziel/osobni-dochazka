-- ============================================================================
-- 007_atomic_lww_upsert.sql
-- Skutečně atomický server-side Last-Write-Wins (LWW) upsert
--
-- Řeší race condition při concurrentním prvním vložení stejného dne (user_key, date)
-- ze dvou různých zařízení.
--
-- Místo dvoukrokového "SELECT ... FOR UPDATE" a následného "INSERT / UPDATE",
-- který může při souběžném prvním zápisu způsobit unique_violation,
-- používá atomický:
--
--   INSERT INTO public.attendance_days (...)
--   VALUES (...)
--   ON CONFLICT (user_key, date)
--   DO UPDATE SET ...
--   WHERE excluded.updated_at >= attendance_days.updated_at
--   RETURNING ...
--
-- Pokud je podmínka WHERE splněna (příchozí je novější nebo stejně nový),
-- provede se UPDATE a RETURNING vrátí ovlivněný řádek -> applied = true.
-- Pokud podmínka splněna není (server má novější záznam), RETURNING nevrátí
-- žádný řádek -> RPC načte stávající záznam a vrátí applied = false, reason = 'server_newer'.
-- ============================================================================

create or replace function public.upsert_attendance_day_lww(
  p_day jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  -- 1. Ověření identity volajícího (Supabase Auth auth.uid() nebo legacy X-Client-Info)
  v_caller_user_key := public.current_profile_user_key();
  if coalesce(v_caller_user_key, '') = '' then
    raise exception 'Neautorizovaný přístup: Uživatel není přihlášen.';
  end if;

  -- 2. Validace payloadu
  v_target_user_key := p_day->>'user_key';
  if v_target_user_key is null or v_target_user_key <> v_caller_user_key then
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
    -- Změna byla úspěšně vložena nebo aktualizována
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
    -- DO UPDATE WHERE podmínka nebyla splněna (server má novější záznam než příchozí)
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

