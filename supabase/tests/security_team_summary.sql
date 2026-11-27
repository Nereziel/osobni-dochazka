begin;
insert into public.attendance_profiles(user_key,username,display_name,role,work_days,daily_target_minutes,break_minutes,break_after_minutes)
values ('user:summary_a','summary_a','Summary A','employee',array[1,2,3,4,5],480,30,360),
       ('user:summary_b','summary_b','Summary B','employee',array[1,2,3,4,5],480,30,360);
insert into public.attendance_credentials(user_key,pin_password_hash)
values ('user:summary_a',crypt('SummaryTest123!',gen_salt('bf')));
select set_config('request.headers','{"x-forwarded-for":"198.51.100.60"}',true);
do $
declare token text;
begin
  token := public.login_attendance_user('summary_a','SummaryTest123!',false)->>'session_token';
  if token is null then raise exception 'Summary fixture login failed'; end if;
  perform set_config('request.headers',jsonb_build_object('x-attendance-session',token)::text,true);
end;
$;

-- Stored metrics intentionally incorrect: view must use current schedule.
insert into public.attendance_days(user_key,date,type,start_time,end_time,worked_minutes,target_minutes,balance_minutes)
values ('user:summary_a','2025-11-03','work','07:00','15:30',1,1,1),
       ('user:summary_a','2025-11-04','work','07:00','',1,1,1),
       ('user:summary_a','2025-11-05','halfVacation','07:00','11:00',1,1,1),
       ('user:summary_a','2025-11-08','vacation','','',1,1,1),
       ('user:summary_a','2025-11-06','vacation','','',1,1,1),
       ('user:summary_b','2025-11-03','work','07:00','15:30',1,1,1),
       ('user:summary_a',(now() at time zone 'Europe/Prague')::date + 1,'work','07:00','15:30',1,1,1);
update public.attendance_days set deleted_at=now() where user_key='user:summary_a' and date='2025-11-06';

set local role anon;
do $$
declare s record;
begin
  select * into s from public.v_monthly_attendance_summary where user_key='user:summary_a' and month='2025-11';
  if not found then raise exception 'Own summary not visible'; end if;
  if s.total_worked_minutes is distinct from 720::bigint or s.total_credited_minutes is distinct from 240::bigint
     or s.total_balance_minutes is distinct from 0::bigint or s.vacation_days_used is distinct from 0.5::numeric then
    raise exception 'Wrong summary metrics: %',row_to_json(s);
  end if;
  if exists(select 1 from public.v_monthly_attendance_summary where user_key='user:summary_b') then raise exception 'Cross-account summary visible'; end if;
  if exists(select 1 from public.v_monthly_attendance_summary where month=to_char((now() at time zone 'Europe/Prague')::date+1,'YYYY-MM') and coalesce(total_worked_minutes,0)<>0) then
    raise exception 'Future shift counted as completed';
  end if;
end;
$$;
reset role;

update public.attendance_profiles set daily_target_minutes=450 where user_key='user:summary_a';
set local role anon;
do $$
begin
  if (select total_balance_minutes from public.v_monthly_attendance_summary where user_key='user:summary_a' and month='2025-11') is distinct from 45::bigint then
    raise exception 'Summary does not reflect current target';
  end if;
end;
$$;
select set_config('request.headers','{}',true);
do $$
begin
  if exists(select 1 from public.v_monthly_attendance_summary) then raise exception 'Anonymous summary visible'; end if;
end;
$$;
reset role;
rollback;
