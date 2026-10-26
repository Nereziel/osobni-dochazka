-- ============================================================================
-- 005_registration_status.sql
-- Anonymní zjištění stavu registrace bez čtení profilů uživatelů
--
-- Tento skript:
-- 1. Vytvoří bezpečnou RPC funkci public.registration_status(),
--    která vrací pouze minimum informací:
--    - requires_invite (boolean)
--    - registration_enabled (boolean)
-- 2. Nikdy nevrací počet uživatelů, jejich ID, username, role ani interní data.
-- ============================================================================

create or replace function public.registration_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_users boolean;
begin
  select exists (
    select 1
    from public.attendance_profiles
    limit 1
  ) into v_has_users;

  return jsonb_build_object(
    'registration_enabled', true,
    'requires_invite', v_has_users
  );
end;
$$;

grant execute on function public.registration_status() to anon, authenticated;

