-- ============================================================================
-- 006_admin_security_fix.sql
-- Zpřísnění funkce is_admin() a oddělení bootstrapu administrátora
--
-- Tento skript:
-- 1. Opravuje bezpečnostní slabinu v `is_admin()`, kde podmínka
--    `NOT EXISTS (select 1 from public.attendance_profiles where role = 'admin')`
--    mohla při prázdné tabulce nebo neexistujícím adminovi nechtěně povýšit
--    anonymního nebo neověřeného uživatele.
-- 2. `is_admin()` nyní vrací TRUE VÝHRADNĚ tehdy, pokud je volající
--    skutečně autentizován (Supabase Auth `auth.uid()` nebo ověřený PIN hash)
--    A jeho role v `attendance_profiles` je 'admin'.
-- 3. Bootstrap prvního admina je možný POUZE přes RPC `register_user_with_invite`,
--    která atomicky zkontroluje počet profilů a pouze prvnímu registrovanému profilu
--    přiřadí roli 'admin'.
-- ============================================================================

-- 1. Přísná a bezpečná implementace is_admin()
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_profiles
    where role = 'admin'
      and (
        (auth_id is not null and auth_id = auth.uid())
        or
        (user_key = public.req_user_key() and pin_hash = public.req_pin_hash())
      )
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- 2. Aktualizace RLS na attendance_invites pro konzistentní ochranu
drop policy if exists "Admin manage invites" on public.attendance_invites;
create policy "Admin manage invites"
  on public.attendance_invites
  for all
  to anon, authenticated
  using (public.is_admin())
  with check (public.is_admin());

