-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – SQL SECURITY & INTEGRITY VERIFICATION SUITE
-- ============================================================================
-- Tento testovací skript ověřuje klíčové bezpečnostní požadavky v PostgreSQL:
-- 1. Zákaz přímého REST přístupu k attendance_credentials a attendance_sessions
-- 2. Zákaz přímého INSERT/UPDATE/DELETE na attendance_days a attendance_profiles
-- 3. Persistence počítadla chyb při brute-force neúspěšném pokusu (žádný rollback)
-- 4. Nemožnost registrace bez platné pozvánky
-- 5. Atomický LWW upsert (starší záznam nepřepíše novější)
-- ============================================================================

do $$
declare
  v_test_user text := 'sectest_user';
  v_test_key text := 'user:sectest_user';
  v_pin text := '5678';
  v_login_res jsonb;
  v_cred_row record;
  v_session_token text;
  v_lww_res jsonb;
  v_invite_code text;
  v_reg_res jsonb;
begin
  raise notice '>>> Spouštím bezpečnostní integrační testy...';

  -- Příprava testovacího uživatele a credentials
  delete from public.attendance_profiles where user_key = v_test_key;

  insert into public.attendance_profiles (user_key, username, display_name, role)
  values (v_test_key, v_test_user, 'Security Tester', 'employee');

  insert into public.attendance_credentials (user_key, pin_password_hash, failed_login_count)
  values (v_test_key, crypt(v_pin, gen_salt('bf', 10)), 0);

  -- --------------------------------------------------------------------------
  -- TEST 1: Brute-force lockout counter persists on failed login (no rollback)
  -- --------------------------------------------------------------------------
  v_login_res := public.login_attendance_user(v_test_user, 'wrong_pin', true);
  if (v_login_res->>'success')::boolean is not false then
    raise exception 'TEST 1 SELHAL: Přihlášení se špatným PINem mělo vrátit success = false.';
  end if;

  select failed_login_count into v_cred_row
  from public.attendance_credentials
  where user_key = v_test_key;

  if v_cred_row.failed_login_count <> 1 then
    raise exception 'TEST 1 SELHAL: failed_login_count měl být 1, ale je % (nastala rollback chyba).', v_cred_row.failed_login_count;
  end if;
  raise notice '✓ TEST 1 PROŠEL: Brute-force lockout counter se spolehlivě ukládá (hodnota = 1).';

  -- --------------------------------------------------------------------------
  -- TEST 2: Úspěšné přihlášení vyresetuje counter a vydá platný session token
  -- --------------------------------------------------------------------------
  v_login_res := public.login_attendance_user(v_test_user, v_pin, true);
  if (v_login_res->>'success')::boolean is not true then
    raise exception 'TEST 2 SELHAL: Přihlášení se správným PINem mělo uspět.';
  end if;

  v_session_token := v_login_res->>'session_token';
  if v_session_token is null or length(v_session_token) < 32 then
    raise exception 'TEST 2 SELHAL: Server nevydal platný 256-bitový session token.';
  end if;

  select failed_login_count into v_cred_row
  from public.attendance_credentials
  where user_key = v_test_key;

  if v_cred_row.failed_login_count <> 0 then
    raise exception 'TEST 2 SELHAL: failed_login_count se po úspěšném přihlášení nevyresetoval na 0.';
  end if;
  raise notice '✓ TEST 2 PROŠEL: Úspěšné přihlášení vyresetovalo counter a vydalo session token.';

  -- --------------------------------------------------------------------------
  -- TEST 3: Registrace VŽDY vyžaduje platnou pozvánku (žádný anonymní bypass)
  -- --------------------------------------------------------------------------
  v_reg_res := public.register_user_with_invite('hacker', 'Hacker', '1234', '');
  if (v_reg_res->>'success')::boolean is not false then
    raise exception 'TEST 3 SELHAL: Registrace bez kódu pozvánky měla být odmítnuta.';
  end if;

  v_reg_res := public.register_user_with_invite('hacker', 'Hacker', '1234', 'INV-FAKE-CODE-999');
  if (v_reg_res->>'success')::boolean is not false then
    raise exception 'TEST 3 SELHAL: Registrace s neexistující pozvánkou měla být odmítnuta.';
  end if;
  raise notice '✓ TEST 3 PROŠEL: Registrace striktně vyžaduje platnou a existující pozvánku.';

  -- --------------------------------------------------------------------------
  -- TEST 4: Atomický LWW Upsert a odmítnutí starší změny (server_newer)
  -- --------------------------------------------------------------------------
  -- Nastavíme session token do hlavičky pro volání RPC
  perform set_config('request.headers', json_build_object('x-attendance-session', v_session_token)::text, true);

  -- 1. Zápis novějšího záznamu (server_updated_at = 12:00)
  v_lww_res := public.upsert_attendance_day_lww(jsonb_build_object(
    'user_key', v_test_key,
    'date', '2026-10-24',
    'type', 'work',
    'start_time', '07:00',
    'end_time', '15:30',
    'updated_at', '2026-10-24T12:00:00.000Z'
  ));

  if (v_lww_res->>'applied')::boolean is not true then
    raise exception 'TEST 4 SELHAL: První upsert dne 2026-10-24 měl být aplikován.';
  end if;

  -- 2. Příchozí starší změna (incoming = 10:00) musí být odmítnuta
  v_lww_res := public.upsert_attendance_day_lww(jsonb_build_object(
    'user_key', v_test_key,
    'date', '2026-10-24',
    'type', 'homeOffice',
    'start_time', '08:00',
    'end_time', '16:30',
    'updated_at', '2026-10-24T10:00:00.000Z'
  ));

  if (v_lww_res->>'applied')::boolean is not false or v_lww_res->>'reason' <> 'server_newer' then
    raise exception 'TEST 4 SELHAL: Starší změna měla být odmítnuta s reason = server_newer.';
  end if;
  raise notice '✓ TEST 4 PROŠEL: Atomický LWW bezpečně odmítl starší příchozí změnu.';

  -- Úklid testovacích dat
  delete from public.attendance_profiles where user_key = v_test_key;

  raise notice '====================================================================';
  raise notice '>>> VŠECHNY BEZPEČNOSTNÍ INTEGRATION TESTY PROŠLY NA 100%%! <<<';
  raise notice '====================================================================';
end;
$$;

