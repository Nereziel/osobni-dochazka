-- Run after applying the least-privilege bundle, against a disposable database.
begin;

do $$
declare
  v_role text;
  v_signature text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_signature in array array[
      'public.current_session_token()',
      'public.current_client_user_agent()',
      'public.admin_cleanup_old_tombstones(integer)',
      'public.upsert_attendance_day_lww(text,text,text,text,text,integer,integer,timestamptz,timestamptz)',
      'public.rls_auto_enable()'
    ] loop
      if to_regprocedure(v_signature) is not null and
          has_function_privilege(v_role, to_regprocedure(v_signature), 'EXECUTE') then
        raise exception 'Unexpected execute privilege: % on %', v_role, v_signature;
      end if;
    end loop;
    foreach v_signature in array array[
      'public.current_session_user_key()',
      'public.is_admin()',
      'public.login_attendance_user(text,text,boolean)',
      'public.verify_attendance_session()',
      'public.upsert_attendance_day_lww(jsonb)',
      'public.admin_step_up(text)',
      'public.admin_reset_user_pin(text,text)'
    ] loop
      if not has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'Required execute privilege missing: % on %', v_role, v_signature;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('current_session_token','current_client_user_agent')
      and not coalesce(p.proconfig @> array['search_path=pg_catalog'], false)
  ) then
    raise exception 'A request helper still has a mutable search_path';
  end if;
end;
$$;

-- Exercise RLS as the actual REST role, not as the database owner.
set local role anon;
select set_config('request.headers', '{}', true);
do $$
begin
  if exists (select 1 from public.attendance_days) or exists (select 1 from public.attendance_profiles) then
    raise exception 'Anonymous API role sees protected attendance or profiles';
  end if;
  if public.current_session_user_key() <> '' or public.is_admin() then
    raise exception 'Anonymous API role unexpectedly has an identity';
  end if;
end;
$$;
reset role;

rollback;
