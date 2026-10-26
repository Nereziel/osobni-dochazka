# Osobní docházka (v3.0.0 · Vue 3 + Vite + Supabase + PWA)

Moderní, bezpečná a plně responzivní progresivní webová aplikace (PWA) pro evidenci osobní docházky, pracovní doby, směn, víkendů a absencí. Funguje jako čistě statická aplikace na **GitHub Pages**, na **mobilních zařízeních (iPhone / iOS Safari, Android)** i na **počítači**, a to jak online, tak **100% offline přes IndexedDB**.

Běží na adrese: `https://nereziel.github.io/osobni-dochazka/`

---

## 🚀 Rychlý start pro vývoj

### Požadavky
- Node.js (v20 nebo novější)
- npm (v10 nebo novější)

### 1. Instalace závislostí
```bash
npm install
```

### 2. Spuštění lokálního vývojového serveru
```bash
npm run dev
```
Aplikace poběží na `http://localhost:5173/osobni-dochazka/`.

### 3. Kontrola kódu a testy
```bash
npm run lint
npm run test
```

### 4. Sestavení produkčního buildu
```bash
npm run build
```
Statický build se vygeneruje do složky `./dist`.

---

## 🛠️ Architektura a technologie

- **Frontend framework**: Vue 3 (Composition API s `<script setup>`)
- **Build nástroj**: Vite (s bází `/osobni-dochazka/`)
- **PWA**: `vite-plugin-pwa` s Workbox serviceworkerem, offline shell a automatickým promptem pro aktualizaci nové verze
- **Lokální databáze**: IndexedDB (verze 4) s rozdělením dat podle uživatele `[userId, date]`, per-user nastavením a transakčním potvrzováním zápisů (`oncomplete`)
- **Synchronizace**: Robustní offline-first outbox fronta se sloučením změn (`coalesce`), skutečnými tombstones (`deleted_at`) a atomickým serverovým Last-Write-Wins (LWW)
- **Backend / Databáze**: Supabase (PostgreSQL, Row Level Security, RPC funkce s `search_path = public`)
- **Testy**: Vitest pro testování výpočtů, absencí, českých svátků, časových převodů i reálného integračního sync motoru

---

## 🔐 Supabase konfigurace a bezpečnost

### Environment proměnné
Pro vývoj i produkci se používají standardní Vite environment proměnné:
- Vytvořte soubor `.env` na základě `.env.example`:

```ini
VITE_SUPABASE_URL=https://vas-projekt.supabase.co
VITE_SUPABASE_ANON_KEY=vas-anon-public-klic
```

> [!IMPORTANT]
> - `VITE_SUPABASE_ANON_KEY` je veřejný publishable klíč, nikdy nepoužívejte `service_role` klíč!
> - Aplikace neakceptuje injektování URL z query parametrů (`?sb_url=`), což brání phishingu a krádeži relací.

---

## 📜 Pořadí a přehled SQL migrací

Všechny SQL skripty jsou uloženy v adresáři [`supabase/migrations/`](./supabase/migrations/) a jsou navrženy jako bezeztrátové a idempotentní:

1. **`001_security_fix.sql`**:
   - **Oprava Privilege Escalation**: Zamezuje běžným uživatelům povýšit se na roli `admin` přímým PATCH REST požadavkem.
   - **Zabezpečení pozvánek**: Odstraněn veřejný `SELECT` z `attendance_invites`. Ověření probíhá přes bezpečnou RPC funkci `verify_invite_code`.
   - **Vysoká entropie tokenů**: Pozvánky generují 128+ bitové kryptografické tokeny s expirací `expires_at`.
   - **Oprava View**: Pohled `v_monthly_attendance_summary` je vytvořen s `security_invoker = true`.
   - **Princip nejmenších oprávnění**: Revokováno `grant all`, nastaven `SET search_path = public` na všech `SECURITY DEFINER` funkcích.

2. **`002_auth_migration.sql`**:
   - Přidává vazbu `auth_id uuid references auth.users(id)` do `attendance_profiles`.
   - Umožňuje bezpečné propojení přihlášeného Supabase Auth účtu s existujícím profilem přes RPC funkci `link_auth_account`.

3. **`003_sync_metadata.sql`**:
   - Přidává sloupec `deleted_at timestamptz` a indexy pro offline mazání (tombstones).

4. **`004_sync_lww_tombstones.sql`**:
   - Zavádí atomickou serverovou RPC funkci `upsert_attendance_day_lww(p_day)`, která porovnává `incoming.updated_at >= existing.updated_at` a brání race conditions při outbox synchronizaci.
   - Zajišťuje, že smazané záznamy s `deleted_at` procházejí stejnou LWW logikou a nepřebíjejí novější úpravy (a naopak novější tombstone spolehlivě maže starší záznamy).
   - Obsahuje maintenance funkci `admin_cleanup_old_tombstones(p_retention_days)` pro bezpečný úklid tombstones starších než 90 dní.

5. **`005_registration_status.sql`**:
   - Zavádí anonymní RPC funkci `registration_status()`, která vrací pouze `{ requires_invite: boolean, registration_enabled: boolean }`.
   - Zabraňuje úniku interních dat o počtu uživatelů a nahrazuje nespolehlivý anonymní `SELECT LIMIT 1`.

6. **`006_admin_security_fix.sql`**:
   - Zpřísňuje `is_admin()` – odstraňuje automatické povýšení při neexistujícím adminovi.
   - Vrací `TRUE` výhradně pro platně ověřeného uživatele (`auth.uid()` nebo ověřený PIN hash) s rolí `admin`.
   - Bootstrap prvního admina je možný pouze atomicky při registraci prvního profilu.

7. **`007_atomic_lww_upsert.sql`**:
   - Skutečně atomický server-side LWW upsert: nahrazuje dvoukrokový `SELECT ... FOR UPDATE` přímým atomickým `INSERT ... ON CONFLICT (user_key, date) DO UPDATE SET ... WHERE excluded.updated_at >= d.updated_at RETURNING *`.
   - Zabraňuje race condition (unique violation) při souběžném prvním vytvoření záznamu stejného dne ze dvou zařízení.

8. **`008_fix_legacy_auth_vulnerability.sql`**:
   - **Oprava P0 autorizační zranitelnosti**: `current_profile_user_key()` již nikdy nekriticky nedůvěřuje hlavičce `req_user_key()`. Legacy identita je uznána výhradně při shodě `user_key` i odpovídajícího `pin_hash`.
   - **Zabezpečení RLS politik**: Všechny politiky pro `attendance_days`, `attendance_profiles` a `attendance_invites` používají ověřenou identitu. Útočník s podvrženou hlavičkou získá 0 řádků na SELECT a odmítnutí na zápis/aktualizaci/smazání.
   - **Autorizace v LWW RPC**: `upsert_attendance_day_lww` ověřuje volajícího přes `current_profile_user_key()` a zakazuje manipulaci s cizími daty (s výjimkou ověřeného administrátora).
   - **Prevence Username Enumeration**: `register_user_with_invite` při běžné registraci nejdříve striktně validuje invite kód, teprve poté kontroluje existenci uživatelského jména. Anonymní útočník bez platné pozvánky nemůže zjišťovat registrovaná uživatelská jména.

9. **`009_custom_sessions.sql`**:
   - **Vlastní bezpečný session systém**: Odstraňuje závislost na Supabase Auth i nebezpečný bearer PIN hash model.
   - **Bcrypt hashování PINu**: Hesla/PINy jsou na serveru hashována pomalým bcryptem (`crypt(pin, gen_salt('bf', 10))`).
   - **256-bitové Opaque Session Tokeny**: V databázi se ukládá pouze SHA-256 hash tokenu (`attendance_sessions.token_hash`).
   - **Plynulá migrace stávajících uživatelů**: Uživatelé s `auth_version = 1` jsou při prvním přihlášení automaticky převedeni na bcrypt bez nutnosti resetovat heslo nebo znovu zakládat účet.
   - **Brute-force ochrana**: Automatický dočasný lockout po 5 (1 min) a 10 (5 min) chybných pokusech.

10. **`010_session_rls.sql`**:
    - **Převod RLS politik na session token**: Všechny tabulky (`attendance_days`, `attendance_profiles`, `attendance_invites`, `attendance_sessions`) ověřují identitu volajícího výhradně ze session tokenu v hlavičce `X-Attendance-Session`.
    - **LWW RPC autorizace přes session**: `upsert_attendance_day_lww` získává identitu volajícího z `current_session_user_key()`.

11. **`011_legacy_cleanup.sql`**:
    - **Registrace s přímým vystavením session**: `register_user_with_invite` ukládá bcrypt hash a ihned vrací session token.
    - **Úklid nepotřebných funkcí**: Odstranění `link_auth_account`, `current_profile_user_key`, `req_user_key`, `req_pin_hash`.

---

## 📊 Přehled stavu funkcí

### Plně implementováno
- **Vlastní bezpečný session systém (bez Supabase Auth)**: Uživatel nepotřebuje e-mail ani externí účet. Přihlášení probíhá přes `username + PIN`. Server vystavuje 256-bitový session token odesílaný v hlavičce `X-Attendance-Session`.
- **Bcrypt hashování na serveru**: PIN je v databázi chráněn funkcí `crypt(pin, gen_salt('bf', 10))`.
- **5s synchronizace v popředí**: Namísto Realtime kanálu aplikace periodicky synchronizuje data každých 5 sekund, pokud je otevřená v popředí a online. Při minimalizaci (hidden) se polling zastaví; po návratu do popředí se okamžitě provede synchronizace.
- **Vue 3 + Vite + Composition API**: Moderní architektura bez starého vanilkového kódu.
- **PWA & Offline Shell**: Plná funkčnost bez internetu na mobilu i desktopu.
- **Per-user IndexedDB**: Oddělení záznamů podle `[userId, date]` a per-user nastavení.
- **Transakční integrita IDB**: Potvrzení zápisu až po `tx.oncomplete`.
- **Atomický Server-side LWW**: Outbox odesílá změny přes RPC `upsert_attendance_day_lww`.
- **Spolehlivé Tombstones**: Smazání nastavuje `deleted_at` a spolehlivě odstraňuje dny na všech synchronizovaných zařízeních.
- **Bezpečnostní RLS a RPC**: Ochrana proti privilege escalation, úniku pozvánek a čtení cizích dat.
- **Biometrické odemknutí**: Rychlé lokální odemknutí uloženého session tokenu v daném prohlížeči (s ověřením platnosti relace proti serveru).

### Známá omezení
- **Původní IndexedDB (v1–v3)**: Původní databáze neobsahovala vlastníka záznamu. Při migraci na v4 jsou stará lokální data přiřazena aktuálně známému profilu. Pokud bylo stejné zařízení ve staré verzi používáno více účty, nelze původního vlastníka historických lokálních záznamů spolehlivě určit. Cloudová data v Supabase tím nejsou ovlivněna.
- **Klientská časová razítka (`updated_at`)**: Last-Write-Wins závisí na správně nastavených systémových hodinách zařízení. Serverová RPC funkce atomicky porovnává `updated_at`, ale při extrémně posunutém systémovém čase na klientu může dojít k nesprávnému vyhodnocení pořadí změn.

---

## 📦 Nasazení na GitHub Pages

Deploy na GitHub Pages je plně automatizovaný přes GitHub Actions workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):

1. Při pushi do větve `main` workflow spustí:
   - `npm ci`
   - `npm run lint`
   - `npm run test` (ověří testy před nasazením)
   - `npm run build` (sestaví aplikaci s klíči ze Secrets)
   - Publikuje složku `./dist` na GitHub Pages
2. **Nastavení GitHub Secrets**:
   - V repozitáři přejděte do **Settings → Secrets and variables → Actions**.
   - Přidejte:
     - `SUPABASE_URL`: URL adresa Supabase projektu
     - `SUPABASE_ANON_KEY`: Veřejný anon klíč projektu
   - V **Settings → Pages** vyberte Source: **GitHub Actions**.
