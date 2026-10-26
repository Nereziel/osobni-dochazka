-- ============================================================================
-- 002_auth_migration.sql
-- Migrace a propojení s oficiálním Supabase Auth
--
-- Tento skript:
-- 1. Přidá sloupec `auth_id uuid references auth.users(id)` do `attendance_profiles`.
-- 2. Umožní RLS ověřovat identitu jak přes `auth.uid()`, tak zpětně kompatibilně
--    přes `X-Client-Info` (req_user_key + req_pin_hash).
-- 3. Poskytne RPC funkci pro propojení existujícího PIN účtu se Supabase Auth.
-- 4. Zachová všechna stávající data uživatelů.
-- ============================================================================

-- 1. Přidání sloupce auth_id do profilů (pokud ještě neexistuje)
alter table public.attendance_profiles
  add column if not exists auth_id uuid references auth.users(id) on delete set null;

create index if not exists idx_attendance_profiles_auth_id
  on public.attendance_profiles (auth_id);

-- 2. Pomocná funkce zjišťující aktuálního uživatele (Supabase Auth přednostně, fallback na PIN header)
create or replace function public.current_profile_user_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- 1. Pokus najít profil podle přihlášeného Supabase Auth uživatele
    (select user_key from public.attendance_profiles where auth_id = auth.uid() limit 1),
    -- 2. Fallback na zpětně kompatibilní hlavičku X-Client-Info
    public.req_user_key(),
    ''
  );
$$;

-- 3. Aktualizovaná funkce is_admin zohledňující Supabase Auth i PIN hash
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
    where (
      (auth_id is not null and auth_id = auth.uid() and role = 'admin')
      or
      (user_key = public.req_user_key() and pin_hash = public.req_pin_hash() and role = 'admin')
      or
      -- Pokud v DB ještě žádný admin není
      not exists (select 1 from public.attendance_profiles where role = 'admin')
    )
  );
$$;

-- 4. RPC pro bezpečné propojení přihlášeného Supabase Auth účtu s existujícím profilem
create or replace function public.link_auth_account(
  p_username text,
  p_pin_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_key text := 'user:' || lower(trim(p_username));
  v_profile public.attendance_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Musíš být přihlášen přes Supabase Auth.';
  end if;

  select * into v_profile
  from public.attendance_profiles
  where user_key = v_user_key and pin_hash = p_pin_hash;

  if not found then
    raise exception 'Neplatné uživatelské jméno nebo PIN.';
  end if;

  update public.attendance_profiles
  set auth_id = auth.uid(),
      updated_at = now()
  where user_key = v_user_key;

  return jsonb_build_object(
    'success', true,
    'user_key', v_profile.user_key,
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'role', v_profile.role
  );
end;
$$;

grant execute on function public.current_profile_user_key() to anon, authenticated;
grant execute on function public.link_auth_account(text, text) to authenticated;

