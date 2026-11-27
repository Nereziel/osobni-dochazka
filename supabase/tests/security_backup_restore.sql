-- Run against a disposable database. All fixtures are rolled back.
begin;
do $$
declare
  token text;
  result jsonb;
  day jsonb := '{"user_key":"user:restoretest","date":"2026-11-25","type":"work","start_time":"07:00","end_time":"15:30","note":"original"}'::jsonb;
begin
  insert into public.attendance_profiles(user_key, username, display_name, role)
  values ('user:restoretest','restoretest','Restore test','employee');
  insert into public.attendance_credentials(user_key, pin_password_hash)
  values ('user:restoretest', crypt('RestoreTest123!',gen_salt('bf')));
  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.55"}', true);
  result := public.login_attendance_user('restoretest','RestoreTest123!',false);
  token := result->>'session_token';
  if token is null then raise exception 'Test login failed'; end if;
  perform set_config('request.headers',jsonb_build_object('x-attendance-session',token)::text,true);
  result := public.restore_attendance_day_if_missing(null);
  if result->>'user_key' is distinct from 'user:restoretest' then raise exception 'Wrong probe identity'; end if;
  result := public.restore_attendance_day_if_missing(day);
  if result->>'applied' is distinct from 'true' then raise exception 'Missing day was not restored'; end if;
  result := public.restore_attendance_day_if_missing(day || '{"note":"changed"}'::jsonb);
  if result->>'reason' is distinct from 'server_exists' then raise exception 'Existing day was overwritten'; end if;
  if (select note from public.attendance_days where user_key='user:restoretest' and date='2026-11-25') is distinct from 'original' then
    raise exception 'Original note changed';
  end if;
  update public.attendance_days set deleted_at=now() where user_key='user:restoretest' and date='2026-11-25';
  result := public.restore_attendance_day_if_missing(day);
  if result->>'reason' is distinct from 'server_exists' then raise exception 'Tombstone was resurrected'; end if;
  begin
    perform public.restore_attendance_day_if_missing(day || '{"user_key":"user:someoneelse"}'::jsonb);
    raise exception 'Cross-account restore accepted' using errcode='P1234';
  exception when sqlstate 'P0001' then null;
  end;
  perform set_config('request.headers','{}',true);
  begin
    perform public.restore_attendance_day_if_missing(day);
    raise exception 'Anonymous restore accepted' using errcode='P1234';
  exception when sqlstate 'P0001' then null;
  end;
end;
$$;
rollback;
