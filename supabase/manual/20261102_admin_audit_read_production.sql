-- ============================================================================
-- OSOBNI DOCHAZKA - PRODUCTION ADMIN AUDIT READ UPDATE (2026-11-02)
--
-- For an EXISTING database that already has the previous security hardening
-- and audit follow-up migrations. Run this entire file once in Supabase SQL
-- Editor before deploying the matching frontend changes.
-- ============================================================================

begin;

drop function if exists public.admin_list_audit_log(integer);
create function public.admin_list_audit_log(p_limit integer default 100)
returns table(
  id bigint,
  actor_user_key text,
  actor_username text,
  actor_display_name text,
  action text,
  target_user_key text,
  target_username text,
  target_display_name text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Přístup odepřen: Pouze správce může číst bezpečnostní audit.';
  end if;

  return query
  select
    l.id,
    l.actor_user_key,
    actor.username,
    actor.display_name,
    l.action,
    l.target_user_key,
    target.username,
    target.display_name,
    l.details,
    l.created_at
  from public.attendance_audit_log l
  left join public.attendance_profiles actor on actor.user_key = l.actor_user_key
  left join public.attendance_profiles target on target.user_key = l.target_user_key
  order by l.created_at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

revoke all on function public.admin_list_audit_log(integer) from public, anon, authenticated;
grant execute on function public.admin_list_audit_log(integer) to anon, authenticated;

commit;
