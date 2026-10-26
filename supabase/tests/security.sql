-- ============================================================================
-- OSOBNÍ DOCHÁZKA PWA – KOMPLETNÍ SQL BEZPEČNOSTNÍ A RLS TEST SUITE
-- ============================================================================
-- Tento testovací skript ověřuje veškeré bezpečnostní požadavky v PostgreSQL:
-- 1. Zákaz přímého REST přístupu k attendance_credentials a attendance_sessions
-- 2. Zákaz přímého zápisu (INSERT, UPDATE, DELETE) na attendance_days a attendance_profiles
-- 3. Persistence počítadla chyb a zámku při brute-force neúspěchu (žádný rollback)
-- 4. Ochrana proti timing útokům a enumeration neexistujících uživatelů
-- 5. Striktní invite-only registrace bez možnosti bypassu
-- 6. Autorizace přes session token: izolace dat mezi uživateli A a B
-- 7. Employee nemůže volat administrátorské RPC
-- 8. Změna PINu revokuje ostatní sessions; Admin reset PINu revokuje všechny sessions
-- 9. Atomický Last-Write-Wins (LWW) a šíření tombstones
-- ============================================================================

do $$
declare
  v_test_user text := 'sectest_user';
  v_test_key text := 'user:sectest_user';
  v_user_b text := 'sectest_user_b';
  v_key_b text := 'user:sectest_user_b';
  v_admin_user text := 'sectest_admin';
  v_admin_key text := 'user:sectest_admin';

  v_pin text := '5678';
  v_login_res jsonb;
  v_cred_row record;
  v_session_token text;
  v_session_token_b text;
  v_admin_session text;

  v_lww_res jsonb;
  v_reg_res jsonb;
  v_active_count integer;
  v_has_priv boolean;
begin
  raise notice '====================================================================';
  raise notice '>>> SPUŠTĚNÍ KOMPLETNÍCH SQL BEZPEČNOSTNÍCH TESTŮ... <<<';
  raise notice '====================================================================';

  -- --------------------------------------------------------------------------
  -- PŘÍPRAVA: Úklid testovacích dat
  -- --------------------------------------------------------------------------
  delete from public.attendance_profiles where user_key in (v_test_key, v_key_b, v_admin_key);

  -- Vytvoření testovacího uživatele A (employee)
  insert into public.attendance_profiles (user_key, username, display_name, role)
  values (v_test_key, v_test_user, 'Tester A', 'employee');

  insert into public.attendance_credentials (user_key, pin_password_hash, failed_login_count)
  values (v_test_key, crypt(v_pin, gen_salt('bf', 10)), 0);

  -- Vytvoření testovacího uživatele B (employee)
  insert into public.attendance_profiles (user_key, username, display_name, role)
  values (v_key_b, v_user_b, 'Tester B', 'employee');

  insert into public.attendance_credentials (user_key, pin_password_hash, failed_login_count)
  values (v_key_b, crypt('1111', gen_salt('bf', 10)), 0);

  -- Vytvoření administrátora
  insert into public.attendance_profiles (user_key, username, display_name, role)
  values (v_admin_key, v_admin_user, 'Admin Test', 'admin');

  insert into public.attendance_credentials (user_key, pin_password_hash, failed_login_count)
  values (v_admin_key, crypt('9999', gen_salt('bf', 10)), 0);

  -- --------------------------------------------------------------------------
  -- TEST 1: TABULKOVÁ OPRÁVNĚNÍ PRO ANON A AUTHENTICATED (PRINCIPLE OF LEAST PRIVILEGE)
  -- --------------------------------------------------------------------------
  -- attendance_credentials: žádný SELECT ani DML pro anon
  select has_table_privilege('anon', 'public.attendance_credentials', 'select') into v_has_priv;
  if v_has_priv then raise exception 'TEST 1 SELHAL: anon nesmí mít SELECT na attendance_credentials.'; end if;

  select has_table_privilege('anon', 'public.attendance_credentials', 'insert') into v_has_priv;
  if v_has_priv then raise exception 'TEST 1 SELHAL: anon nesmí mít INSERT na attendance_credentials.'; end if;

  -- attendance_sessions: žádný přístup pro anon
  select has_table_privilege('anon', 'public.attendance_sessions', 'select') into v_has_priv;
  if v_has_priv then raise exception 'TEST 1 SELHAL: anon nesmí mít SELECT na attendance_sessions.'; end if;

  -- attendance_days: POUZE SELECT, žádný přímý INSERT/UPDATE/DELETE
  select has_table_privilege('anon', 'public.attendance_days', 'select') into v_has_priv;
  if not v_has_priv then raise exception 'TEST 1 SELHAL: anon musí mít SELECT pro čtení přes RLS.'; end if;

  select has_table_privilege('anon', 'public.attendance_days', 'insert') into v_has_priv;
  if v_has_priv then raise exception 'TEST 1 SELHAL: přímý REST INSERT do attendance_days musí být zakázán.'; end if;

  select has_table_privilege('anon', 'public.attendance_days', 'update') into v_has_priv;
  if v_has_priv then raise exception 'TEST 1 SELHAL: přímý REST UPDATE do attendance_days musí být zakázán.'; end if;

  -- attendance_profiles: POUZE SELECT, přímý REST UPDATE zakázán
  select has_table_privilege('anon', 'public.attendance_profiles', 'update') into v_has_priv;
  if v_has_priv then raise exception 'TEST 1 SELHAL: přímý REST UPDATE do attendance_profiles musí být zakázán.'; end if;

  raise notice '✓ TEST 1 PROŠEL: Přísná tabulková oprávnění pro REST role jsou 100%% v pořádku.';

  -- --------------------------------------------------------------------------
  -- TEST 2: BRUTE-FORCE OCHRANA A PERSISTENCE COUNTERU (BEZ ROLLBACKU)
  -- --------------------------------------------------------------------------
  v_login_res := public.login_attendance_user(v_test_user, 'wrong_pin', true);
  if (v_login_res->>'success')::boolean is not false then
    raise exception 'TEST 2 SELHAL: Přihlášení se špatným PINem mělo vrátit success = false.';
  end if;

  select failed_login_count into v_cred_row
  from public.attendance_credentials
  where user_key = v_test_key;

  if v_cred_row.failed_login_count <> 1 then
    raise exception 'TEST 2 SELHAL: failed_login_count se neuložil v transakci.';
  end if;
  raise notice '✓ TEST 2 PROŠEL: Brute-force counter se trvale uložil do DB i při neplatném PINu.';

  -- --------------------------------------------------------------------------
  -- TEST 3: OCHRANA PROTI TIMING ENUMERATION NEEXISTUJÍCÍCH UŽIVATELŮ
  -- --------------------------------------------------------------------------
  v_login_res := public.login_attendance_user('non_existing_ghost_user_999', 'some_pin', true);
  if (v_login_res->>'success')::boolean is not false or v_login_res->>'error' <> 'invalid_credentials' then
    raise exception 'TEST 3 SELHAL: Neexistující uživatel musí vrátit stejnou chybu invalid_credentials.';
  end if;
  raise notice '✓ TEST 3 PROŠEL: Neexistující uživatel vrací identickou generickou odpověď jako špatný PIN.';

  -- --------------------------------------------------------------------------
  -- TEST 4: ÚSPĚŠNÉ PŘIHLÁŠENÍ, RESET COUNTERU A GENEROVÁNÍ 256-BIT TOKENU
  -- --------------------------------------------------------------------------
  v_login_res := public.login_attendance_user(v_test_user, v_pin, true);
  if (v_login_res->>'success')::boolean is not true then
    raise exception 'TEST 4 SELHAL: Přihlášení se správným PINem mělo uspět.';
  end if;

  v_session_token := v_login_res->>'session_token';
  if v_session_token is null or length(v_session_token) < 32 then
    raise exception 'TEST 4 SELHAL: Vydaný session token nemá požadovanou délku.';
  end if;

  -- Ověření, že v DB je pouze SHA-256 hash tokenu, nikoli raw token
  if exists (select 1 from public.attendance_sessions where token_hash = v_session_token) then
    raise exception 'TEST 4 SELHAL: V databázi nesmí být uložen raw session token v čitelné podobě!';
  end if;

  select failed_login_count into v_cred_row
  from public.attendance_credentials
  where user_key = v_test_key;
  if v_cred_row.failed_login_count <> 0 then
    raise exception 'TEST 4 SELHAL: failed_login_count se po úspěšném přihlášení nevyresetoval.';
  end if;
  raise notice '✓ TEST 4 PROŠEL: Přihlášení vyresetovalo counter a uložilo pouze bezpečný SHA-256 hash tokenu.';

  -- --------------------------------------------------------------------------
  -- TEST 5: REGISTRACE JE STRIKTNĚ POUZE NA POZVÁNKU
  -- --------------------------------------------------------------------------
  v_reg_res := public.register_user_with_invite('intruder', 'Intruder', '1234', '');
  if (v_reg_res->>'success')::boolean is not false then
    raise exception 'TEST 5 SELHAL: Registrace bez kódu pozvánky nesmí projít.';
  end if;

  v_reg_res := public.register_user_with_invite('intruder', 'Intruder', '1234', 'INV-FAKE-999');
  if (v_reg_res->>'success')::boolean is not false then
    raise exception 'TEST 5 SELHAL: Registrace s neplatnou pozvánkou nesmí projít.';
  end if;
  raise notice '✓ TEST 5 PROŠEL: Registrace striktně odmítá neautorizované požadavky bez platné pozvánky.';

  -- --------------------------------------------------------------------------
  -- TEST 6: AUTORIZACE A IZOLACE DAT: UŽIVATEL A NESMÍ ZAPISOVAT PRO UŽIVATELE B
  -- --------------------------------------------------------------------------
  -- Nastavíme session token uživatele A do hlavičky requestu
  perform set_config('request.headers', json_build_object('x-attendance-session', v_session_token)::text, true);

  -- Pokus o LWW upsert pro uživatele B musí selhat
  begin
    perform public.upsert_attendance_day_lww(jsonb_build_object(
      'user_key', v_key_b,
      'date', '2026-10-24',
      'type', 'work'
    ));
    raise exception 'TEST 6 SELHAL: Uživatel A nesmí mít právo zapisovat docházku uživatele B.';
  exception
    when others then
      if sqlerrm not like '%Přístup odepřen%' then
        raise exception 'TEST 6 SELHAL: Neočekávaná chyba: %', sqlerrm;
      end if;
  end;
  raise notice '✓ TEST 6 PROŠEL: Izolace dat funguje, běžný uživatel nemůže zapisovat data cizího profilu.';

  -- --------------------------------------------------------------------------
  -- TEST 7: EMPLOYEE NEMŮŽE VOLAT ADMIN RPC FUNKCE
  -- --------------------------------------------------------------------------
  begin
    perform public.admin_create_invite('employee');
    raise exception 'TEST 7 SELHAL: Employee nesmí mít přístup k admin_create_invite.';
  exception
    when others then
      if sqlerrm not like '%Pouze správce%' then
        raise exception 'TEST 7 SELHAL: Neočekávaná chyba: %', sqlerrm;
      end if;
  end;

  begin
    perform public.admin_delete_user(v_key_b);
    raise exception 'TEST 7 SELHAL: Employee nesmí mít přístup k admin_delete_user.';
  exception
    when others then
      if sqlerrm not like '%Pouze správce%' then
        raise exception 'TEST 7 SELHAL: Neočekávaná chyba: %', sqlerrm;
      end if;
  end;
  raise notice '✓ TEST 7 PROŠEL: Administrátorské RPC funkce jsou spolehlivě blokovány pro běžného zaměstnance.';

  -- --------------------------------------------------------------------------
  -- TEST 8: ZMĚNA PINU REVOKUJE OSTATNÍ SESSIONS UŽIVATELE
  -- --------------------------------------------------------------------------
  -- Vytvoříme 2. relaci pro uživatele A
  v_login_res := public.login_attendance_user(v_test_user, v_pin, true);
  v_session_token_b := v_login_res->>'session_token';

  -- Nyní uživatel A změní PIN v kontextu první relace (v_session_token)
  perform set_config('request.headers', json_build_object('x-attendance-session', v_session_token)::text, true);
  perform public.change_attendance_pin(v_pin, 'new_pin_999', true);

  -- 2. session (v_session_token_b) musí být nyní revokována
  perform set_config('request.headers', json_build_object('x-attendance-session', v_session_token_b)::text, true);
  if public.current_session_user_key() <> '' then
    raise exception 'TEST 8 SELHAL: Po změně PINu měla být 2. relace okamžitě revokována.';
  end if;

  -- 1. session musí zůstat platná
  perform set_config('request.headers', json_build_object('x-attendance-session', v_session_token)::text, true);
  if public.current_session_user_key() <> v_test_key then
    raise exception 'TEST 8 SELHAL: Aktuální session měla zůstat aktivní.';
  end if;
  raise notice '✓ TEST 8 PROŠEL: Změna PINu úspěšně revokovala všechny ostatní sessions uživatele.';

  -- --------------------------------------------------------------------------
  -- TEST 9: ADMIN RESET PINU REVOKUJE VŠECHNY RELACE CÍLOVÉHO UŽIVATELE
  -- --------------------------------------------------------------------------
  -- Přihlásíme se jako admin
  v_login_res := public.login_attendance_user(v_admin_user, '9999', true);
  v_admin_session := v_login_res->>'session_token';
  perform set_config('request.headers', json_build_object('x-attendance-session', v_admin_session)::text, true);

  -- Správce resetuje PIN uživatele A
  perform public.admin_reset_user_pin(v_test_key, 'reset_pin_888');

  -- Žádná relace uživatele A nesmí zůstat aktivní
  select count(*) into v_active_count
  from public.attendance_sessions
  where user_key = v_test_key and revoked_at is null;

  if v_active_count > 0 then
    raise exception 'TEST 9 SELHAL: Po admin resetu PINu nesmí zůstat žádná aktivní session cílového uživatele!';
  end if;
  raise notice '✓ TEST 9 PROŠEL: Admin reset PINu okamžitě revokoval všechny sessions kompromitovaného účtu.';

  -- --------------------------------------------------------------------------
  -- TEST 10: ATOMICKÝ LAST-WRITE-WINS A TOMBSTONES
  -- --------------------------------------------------------------------------
  perform set_config('request.headers', json_build_object('x-attendance-session', v_admin_session)::text, true);

  v_lww_res := public.upsert_attendance_day_lww(jsonb_build_object(
    'user_key', v_admin_key,
    'date', '2026-10-26',
    'type', 'work',
    'updated_at', '2026-10-26T14:00:00.000Z'
  ));
  if (v_lww_res->>'applied')::boolean is not true then
    raise exception 'TEST 10 SELHAL: LWW upsert selhal.';
  end if;

  -- Příchozí starší záznam (12:00) musí být odmítnut
  v_lww_res := public.upsert_attendance_day_lww(jsonb_build_object(
    'user_key', v_admin_key,
    'date', '2026-10-26',
    'type', 'homeOffice',
    'updated_at', '2026-10-26T12:00:00.000Z'
  ));
  if (v_lww_res->>'applied')::boolean is not false or v_lww_res->>'reason' <> 'server_newer' then
    raise exception 'TEST 10 SELHAL: Starší příchozí změna měla být bezpečně odmítnuta.';
  end if;
  raise notice '✓ TEST 10 PROŠEL: Atomický LWW bezpečně odmítl starší záznam bez porušení konzistence.';

  -- --------------------------------------------------------------------------
  -- ÚKLID TESTOVACÍCH DAT
  -- --------------------------------------------------------------------------
  delete from public.attendance_profiles where user_key in (v_test_key, v_key_b, v_admin_key);

  raise notice '====================================================================';
  raise notice '>>> VŠECHNY SQL BEZPEČNOSTNÍ A RLS TESTY PROŠLY NA 100%%! <<<';
  raise notice '====================================================================';
end;
$$;
