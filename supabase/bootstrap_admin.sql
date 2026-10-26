-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – INICIALIZACE PRVNÍHO SPRÁVCE (BOOTSTRAP ADMIN)
-- ============================================================================
-- Tento skript spusť v Supabase SQL Editoru PO aplikaci supabase/schema.sql.
-- Vytvoří výchozího administrátora systému s rolí 'admin'.
--
-- Výchozí přihlašovací údaje:
--   Uživatelské jméno: admin
--   PIN: 1234
--
-- DŮLEŽITÉ:
-- Po prvním přihlášení doporučujeme PIN administrátora okamžitě změnit
-- v nastavení profilu.
-- ============================================================================

create extension if not exists pgcrypto;

do $$
declare
  v_username text := 'admin';
  v_pin text := '1234';
  v_display_name text := 'Hlavní správce';
  v_user_key text;
  v_bcrypt text;
begin
  v_user_key := 'user:' || v_username;
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
    v_username,
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

  raise notice 'Administrátor "%" (PIN: %) byl úspěšně zinicializován.', v_username, v_pin;
end;
$$;

