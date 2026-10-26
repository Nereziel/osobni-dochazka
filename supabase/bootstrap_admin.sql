-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – INICIALIZACE PRVNÍHO SPRÁVCE (BOOTSTRAP ADMIN)
-- ============================================================================
-- Tento skript spusť v Supabase SQL Editoru PO aplikaci supabase/schema.sql.
-- Vytvoří výchozího administrátora systému s rolí 'admin'.
--
-- DŮLEŽITÉ BEZPEČNOSTNÍ POKYNY:
-- 1. Před spuštěním upravte hodnoty v_username a v_pin níže na vlastní hodnoty!
-- 2. Tento soubor po nastavení nikdy necommitujte se skutečným heslem do Gitu.
-- ============================================================================

create extension if not exists pgcrypto;

do $$
declare
  -- ==========================================================================
  -- NASTAVTE SI VLASTNÍ PŘIHLAŠOVACÍ ÚDAJE SPRÁVCE PŘED SPUŠTĚNÍM:
  -- ==========================================================================
  v_username text := 'CHANGE_ME_ADMIN_USERNAME'; -- např. 'spravce'
  v_pin text := 'CHANGE_ME_ADMIN_PIN';           -- např. '9876' (min. 4 znaky)
  v_display_name text := 'Hlavní správce';
  -- ==========================================================================

  v_user_key text;
  v_bcrypt text;
begin
  -- Bezpečnostní pojistka proti spuštění s výchozím placeholderem
  if v_username = 'CHANGE_ME_ADMIN_USERNAME' or v_pin = 'CHANGE_ME_ADMIN_PIN' then
    raise exception 'BEZPEČNOSTNÍ POJISTKA: Upravte prosím proměnné v_username a v_pin na vlastní hodnoty před spuštěním skriptu bootstrap_admin.sql.';
  end if;

  if length(v_pin) < 4 then
    raise exception 'PIN administrátora musí mít alespoň 4 znaky.';
  end if;

  v_user_key := 'user:' || lower(trim(v_username));
  v_bcrypt := crypt(v_pin, gen_salt('bf', 10));

  -- 1. Vložení veřejného profilu správce
  insert into public.attendance_profiles (
    user_key,
    username,
    display_name,
    role,
    work_start,
    work_end,
    daily_target_minutes,
    break_minutes,
    auto_fill,
    work_days,
    theme
  ) values (
    v_user_key,
    lower(trim(v_username)),
    v_display_name,
    'admin',
    '06:30',
    '15:30',
    510,
    30,
    true,
    '{1,2,3,4,5}',
    'system'
  )
  on conflict (user_key) do update
  set role = 'admin',
      display_name = excluded.display_name,
      updated_at = now();

  -- 2. Vložení privátních přihlašovacích údajů do attendance_credentials
  insert into public.attendance_credentials (
    user_key,
    pin_password_hash,
    failed_login_count,
    locked_until,
    updated_at
  ) values (
    v_user_key,
    v_bcrypt,
    0,
    null,
    now()
  )
  on conflict (user_key) do update
  set pin_password_hash = excluded.pin_password_hash,
      failed_login_count = 0,
      locked_until = null,
      updated_at = now();

  raise notice 'Administrátor "%" byl úspěšně zinicializován.', v_username;
end;
$$;
