# Bezpečnostní a autentizační architektura

Tento dokument popisuje aktuální bezpečnostní model aplikace **Osobní docházka PWA** po hardeningu z 2. 11. 2026.

## 1. Identita a session

Aplikace nepoužívá Supabase Auth. Uživatel se přihlašuje kombinací `uživatelské jméno + PIN / heslo` přes kontrolované PostgreSQL RPC.

- PIN/heslo je uloženo pouze jako bcrypt hash v `attendance_credentials`.
- Úspěšný login vytvoří 256bitový náhodný session token.
- V databázi se ukládá pouze SHA-256 hash tokenu.
- Browser posílá raw token v hlavičce `X-Attendance-Session`.
- Bez „Pamatovat si mě“ se token ukládá do `sessionStorage`; dlouhodobé uložení v `localStorage` je opt-in.
- Změna vlastního PINu revokuje všechny staré sessions a vydá nový token.

Citlivé tabulky `attendance_credentials`, `attendance_sessions`, `attendance_login_rate_limits` a `attendance_audit_log` nejsou přímo dostupné REST rolím `anon` ani `authenticated`.

## 2. Login a ochrana proti zneužití

`login_attendance_user` vrací pro neplatné přihlašovací údaje generickou odpověď a používá bcrypt i pro neexistujícího uživatele, aby se omezila username enumeration přes timing.

Ochrana proti online hádání hesel je založená na serverovém rate limitingu:

- per IP + username: 10 pokusů v 5minutovém okně, následně 10minutový blok daného bucketu,
- obecný per-IP bucket: 60 login volání v 5minutovém okně,
- úspěšný login resetuje per-IP/per-user bucket.

Historická pole `failed_login_count` a `locked_until` zůstávají v credential tabulce kvůli kompatibilitě, ale veřejný účet už není globálně zamykán pouze na základě pokusů z jedné cizí IP. Tím se omezuje možnost DoS konkrétního účtu.

## 3. Autorizace a RLS

Identitu každého requestu odvozuje `current_session_user_key()` z hashe `X-Attendance-Session`.

- `attendance_profiles`: uživatel čte vlastní profil; admin může číst profily týmu.
- `attendance_days`: uživatel čte vlastní docházku; admin může číst týmová data.
- `attendance_invites`: nemají přímý Data API `SELECT`; seznam jde přes `admin_list_invites()`.
- zápisy docházky jdou přes `upsert_attendance_day_lww()`.
- změny vlastních nastavení jdou přes `update_own_settings()`.

Kritické rozhodnutí se vždy ověřuje na serveru. Role uložená ve Vue klientu není autoritativní.

## 4. Integrita docházky

Klient může poslat vstupní hodnoty dne, ale server nevěří odvozeným metrikám. RPC `upsert_attendance_day_lww()` přepočítává například:

- přestávku,
- odpracované minuty,
- omluvené minuty,
- denní fond,
- saldo.

Server zároveň omezuje velikost a rozsah ukládaných dat. Nové zápisy mají guardrails mimo jiné pro délku poznámky, velikost `settings_json`, délku jmen a rozumný rozsah data.

## 5. Registrace a pozvánky

Veřejná registrace je **vždy invite-only**.

- `register_user_with_invite()` bez platné jednorázové pozvánky účet nevytvoří.
- nový veřejně registrovaný účet dostává roli `employee`.
- neexistuje veřejný režim „první uživatel = admin“.
- prvního správce nové instalace je nutné vytvořit důvěryhodným administrátorským postupem mimo veřejný registrační endpoint.
- invite kódy se generují kryptograficky náhodně a jsou jednorázové s expirací.
- odkazy používají `#invite=...`, aby se nový invite token neposílal serveru v HTTP query stringu.

Bezpečný bootstrap databáze je popsán v `supabase/README.md`.

## 6. Step-up autentizace správce

Samotná ukradená admin session nemá stačit pro vytvoření trvalé administrátorské persistence.

Citlivé administrátorské operace proto vyžadují opětovné zadání současného admin PINu/hesla:

- změna role uživatele,
- smazání uživatele,
- reset PINu jiného uživatele.

Reset vlastního admin PINu přes privilegované reset RPC je zakázaný; správce musí použít standardní `change_attendance_pin()`, které ověřuje jeho současný PIN.

Pro kompatibilní reset workflow může `admin_step_up()` na stejné bearer session vystavit krátkou 5minutovou elevaci. Pomocné step-up funkce samy nejsou veřejné Data API operace kromě výslovně určeného RPC.

## 7. Audit log

Bezpečnostně významné administrátorské akce zapisují serverová RPC do `attendance_audit_log`, například:

- vytvoření/smazání invite,
- změna role,
- reset PINu,
- smazání uživatele,
- step-up ověření.

Audit tabulka není přímo čitelná ani zapisovatelná rolemi `anon` a `authenticated`.

## 8. Offline data

Docházka, nastavení a synchronizační outbox jsou kvůli offline režimu uloženy v IndexedDB. To je vědomý bezpečnostní kompromis: RLS chrání cloudová data, ale lokální browser profil má k vlastní IndexedDB přístup.

Session revokace se při online provozu kontroluje periodicky. Offline zařízení může dočasně zobrazovat již lokálně uložená data, dokud se znovu nepřipojí nebo nejsou lokální data odstraněna.

## 9. Browser a deployment ochrany

Cloudflare Pages posílá mimo jiné:

- Content-Security-Policy,
- HSTS,
- `X-Content-Type-Options: nosniff`,
- `X-Frame-Options: DENY`,
- `Referrer-Policy: no-referrer`,
- omezené `Permissions-Policy`.

`connect-src` je omezený na konkrétní produkční Supabase projekt. Frontend neobsahuje `service_role` klíč; publishable/anon klíč je z principu veřejná hodnota a bezpečnost dat stojí na serverových grants, RLS a RPC autorizaci.

## 10. Testování

GitHub Actions staví testovací PostgreSQL databázi ze:

1. `supabase/schema_base.sql`,
2. všech aktuálních bezpečnostních migrací v pořadí.

Potom spouští:

- `supabase/tests/security_hardening.sql`,
- `supabase/tests/security_audit_followup.sql`.

Regresní testy kontrolují mimo jiné invite-only registraci, přímá REST oprávnění, rotaci sessions, serverový přepočet docházky, rate limiting, step-up administrátorských operací, audit log a serverové vstupní limity.
