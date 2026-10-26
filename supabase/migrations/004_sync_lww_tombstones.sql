-- ============================================================================
-- 004_sync_lww_tombstones.sql
-- Server-side Last-Write-Wins (LWW) and reliable Tombstones for attendance_days
--
-- Tento skript:
-- 1. Vytvoří atomickou RPC funkci public.upsert_attendance_day_lww()
--    která provede vložení / úpravu / soft-delete (tombstone) pouze pokud
--    nová změna je novější nebo stejně nová jako existující záznam (incoming.updated_at >= existing.updated_at).
-- 2. Ověří identitu volajícího (Supabase Auth uid() nebo platný legacy userKey + pinHash).
-- 3. Zabrání zápisu nebo mazání dat jiného uživatele.
-- 4. Přidá funkci pro bezpečný maintenance cleanup starých tombstones (starších než 90 dní).
-- ============================================================================

-- 1. Atomická RPC funkce pro LWW upsert a tombstones
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
  v_existing public.attendance_days%rowtype;
  v_incoming_deleted_at timestamptz;
  v_type text;
  v_start_time text;
  v_end_time text;
  v_manual_break boolean;
  v_break_minutes integer;
  v_doctor_full_day boolean;
  v_doctor_start text;
  v_doctor_end text;
  v_other_minutes integer;
  v_worked_minutes integer;
  v_credited_minutes integer;
  v_target_minutes integer;
  v_balance_minutes integer;
  v_note text;
begin
  -- 1. Ověření identity volajícího (zauth.uid() nebo legacy X-Client-Info)
  v_caller_user_key := public.current_profile_user_key();
  if coalesce(v_caller_user_key, '') = '' then
    raise exception 'Neautorizovaný přístup: Uživatel není přihlášen.';
  end if;

  -- 2. Validace payloadu
  v_target_user_key := p_day->>'user_key';
  if v_target_user_key is null or v_target_user_key <> v_caller_user_key then
    -- Uživatel nesmí manipulovat se záznamy cizího uživatele
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

  -- 3. Získání stávajícího záznamu (pokud existuje) se zámkem řádku pro atomicitu
  select * into v_existing
  from public.attendance_days
  where user_key = v_target_user_key and date = v_date
  for update;

  -- 4. Kontrola Last-Write-Wins
  if found then
    -- Pokud stávající záznam má novější updated_at než příchozí, odmítneme změnu
    if v_existing.updated_at > v_incoming_updated_at then
      return jsonb_build_object(
        'applied', false,
        'reason', 'server_newer',
        'server_updated_at', v_existing.updated_at,
        'incoming_updated_at', v_incoming_updated_at,
        'date', v_date
      );
    end if;

    -- Aktualizace existujícího řádku (může být i tombstone)
    update public.attendance_days
    set
      type = coalesce(p_day->>'type', v_existing.type, 'work'),
      start_time = coalesce(p_day->>'start_time', v_existing.start_time, ''),
      end_time = coalesce(p_day->>'end_time', v_existing.end_time, ''),
      manual_break = coalesce((p_day->>'manual_break')::boolean, v_existing.manual_break, false),
      break_minutes = coalesce((p_day->>'break_minutes')::integer, v_existing.break_minutes, 0),
      doctor_full_day = coalesce((p_day->>'doctor_full_day')::boolean, v_existing.doctor_full_day, false),
      doctor_start = coalesce(p_day->>'doctor_start', v_existing.doctor_start, ''),
      doctor_end = coalesce(p_day->>'doctor_end', v_existing.doctor_end, ''),
      other_minutes = coalesce((p_day->>'other_minutes')::integer, v_existing.other_minutes, 0),
      worked_minutes = coalesce((p_day->>'worked_minutes')::integer, v_existing.worked_minutes, 0),
      credited_minutes = coalesce((p_day->>'credited_minutes')::integer, v_existing.credited_minutes, 0),
      target_minutes = coalesce((p_day->>'target_minutes')::integer, v_existing.target_minutes, 0),
      balance_minutes = coalesce((p_day->>'balance_minutes')::integer, v_existing.balance_minutes, 0),
      note = coalesce(p_day->>'note', v_existing.note, ''),
      deleted_at = v_incoming_deleted_at,
      updated_at = v_incoming_updated_at
    where user_key = v_target_user_key and date = v_date;

    return jsonb_build_object(
      'applied', true,
      'action', case when v_incoming_deleted_at is not null then 'tombstone_updated' else 'updated' end,
      'date', v_date,
      'server_updated_at', v_incoming_updated_at
    );
  else
    -- Vložení nového řádku (včetně případného nového tombstone)
    insert into public.attendance_days (
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
    );

    return jsonb_build_object(
      'applied', true,
      'action', case when v_incoming_deleted_at is not null then 'tombstone_inserted' else 'inserted' end,
      'date', v_date,
      'server_updated_at', v_incoming_updated_at
    );
  end if;
end;
$$;

grant execute on function public.upsert_attendance_day_lww(jsonb) to anon, authenticated;

-- 2. Maintenance funkce pro bezpečný úklid starých tombstones (starších než 90 dní)
-- Pouze administrátor může spustit cleanup.
create or replace function public.admin_cleanup_old_tombstones(
  p_retention_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
  v_cutoff timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může provádět údržbu databáze.';
  end if;

  if p_retention_days < 30 then
    raise exception 'Minimální retenční lhůta pro tombstones je 30 dní.';
  end if;

  v_cutoff := now() - (p_retention_days || ' days')::interval;

  delete from public.attendance_days
  where deleted_at is not null
    and deleted_at < v_cutoff;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object(
    'success', true,
    'deleted_tombstones', v_deleted_count,
    'cutoff_date', v_cutoff
  );
end;
$$;

grant execute on function public.admin_cleanup_old_tombstones(integer) to anon, authenticated;

