# Bezpečnostní a Autentizační Architektura (Osobní docházka PWA)

Tento dokument popisuje autentizaci, autorizaci a bezpečnostní model aplikace **Osobní docházka PWA** v čisté PostgreSQL/Supabase architektuře.

---

## 1. Principy a Cíle

1. **Uživatelská přívětivost (Username + PIN)**:
   - Uživatel se přihlašuje výhradně kombinací `uživatelské jméno + PIN / heslo`.
   - Není vyžadován e-mail, magic link ani externí cloudový účet (`auth.users`).

2. **Kryptografická bezpečnost**:
   - PIN se na klientovi neposílá jako trvalá identity ani bearer token.
   - Na serveru je PIN hashován pomocí **bcrypt** (funkce `crypt()` a `gen_salt('bf', 10)` z rozšíření `pgcrypto`).
   - Přihlášení vydává kryptograficky náhodný **256-bitový session token** (`gen_random_bytes(32)`).
   - V databázi se ukládá výhradně **SHA-256 hash** tohoto tokenu. Při kompromitaci DB útočník nezíská platné tokeny.

3. **Oddělení citlivých dat (Separation of Concerns)**:
   - Veřejná data profilu a nastavení směn jsou uložena v tabulce `attendance_profiles`.
   - Citlivé přihlašovací údaje (bcrypt hash PINu, čítač chyb, čas uzamčení) jsou uloženy v privátní tabulce `attendance_credentials`.
   - Aktivní relace jsou uloženy v privátní tabulce `attendance_sessions`.
   - K tabulkám `attendance_credentials` a `attendance_sessions` mají REST klienti (`anon`, `authenticated`) **zcela zakázaný přístup** (`REVOKE ALL`). Přístup probíhá výhradně přes přísně kontrolované `SECURITY DEFINER` RPC funkce.

4. **Zákaz přímého zápisu přes REST (RPC-Only Writes)**:
   - Tabulky `attendance_days` a `attendance_profiles` mají přes REST povolen **pouze SELECT** chráněný Row Level Security (RLS).
   - Zápis docházky probíhá výhradně přes atomickou LWW RPC funkci `upsert_attendance_day_lww`.
   - Aktualizace nastavení profilu probíhá výhradně přes RPC funkci `update_own_settings`.

5. **Odolnost proti výpadku sítě (Offline-First Session)**:
   - Při dočasné nedostupnosti sítě nebo běhu v offline režimu klient (`useAuth`) **neodlašuje** uživatele.
   - Odhlášení nastává výhradně při explicitní odpovědi serveru (kód 401/403 nebo revokovaná/expirovaná session).

---

## 2. Diagram Autentizačního Toku

```text
Klient (PWA)                                   PostgreSQL (Supabase)
    │                                                    │
    ├──────── 1. POST /rpc/login_attendance_user ───────>│
    │         { username, pin, remember }                │
    │                                                    ├─ Ověření existence v attendance_profiles
    │                                                    ├─ Kontrola locked_until v attendance_credentials
    │                                                    ├─ Ověření bcrypt hashe crypt(pin, hash)
    │                                                    │
    │                                            [Chyba] ├─ Zvýšení failed_login_count
    │                                                    ├─ Případné nastavení locked_until
    │                                                    ├─ COMMIT transakce (žádný rollback)
    │                                                    └─ Návrat { success: false, error: ... }
    │                                                    │
    │                                           [Úspěch] ├─ Reset failed_login_count = 0
    │                                                    ├─ gen_random_bytes(32) -> rawToken
    │                                                    ├─ INSERT do attendance_sessions (SHA-256 hash)
    │                                                    └─ Návrat { success: true, session_token, ... }
    │                                                    │
    │<─────── 2. JSON odpověď se session_token ──────────┤
    │
    │ 3. Uložení rawToken do Secure Storage (localStorage/sessionStorage)
    │
    ├──────── 4. Běžný API request ──────────────────────>│
    │         Hlavička: X-Attendance-Session: <rawToken>  ├─ current_session_token()
    │                                                    ├─ current_session_user_key() -> SHA-256 -> user_key
    │                                                    ├─ RLS politika ověří vlastnictví
    │<─────── 5. Odpověď s daty ─────────────────────────┤
```

---

## 3. Datový Model

### `public.attendance_profiles`
Veřejný profil uživatele a nastavení pracovní doby.
- `user_key` (`text`, PK, např. `'user:martin'`)
- `username` (`text`, UNIQUE NOT NULL)
- `display_name` (`text`, NOT NULL)
- `role` (`text`, `'employee'` nebo `'admin'`)
- Pracovní parametry: `work_start`, `work_end`, `daily_target_minutes`, `break_minutes`, `work_days`, `weekend_mode`, `theme`, `settings_json`
- `created_at`, `updated_at`

### `public.attendance_credentials` *(Privátní, server-only)*
- `user_key` (`text`, PK, FK na `attendance_profiles.user_key` ON DELETE CASCADE)
- `pin_password_hash` (`text`, bcrypt hash)
- `failed_login_count` (`integer`, čítač neúspěšných přihlášení)
- `locked_until` (`timestamptz`, čas dočasného uzamčení)
- `last_failed_login_at` (`timestamptz`)
- `updated_at` (`timestamptz`)

### `public.attendance_sessions` *(Privátní, server-only)*
- `id` (`uuid`, PK)
- `user_key` (`text`, FK na `attendance_profiles.user_key` ON DELETE CASCADE)
- `token_hash` (`text`, UNIQUE, SHA-256 hash raw tokenu)
- `created_at` (`timestamptz`)
- `expires_at` (`timestamptz`)
- `last_used_at` (`timestamptz`)
- `revoked_at` (`timestamptz`, NULL pokud je relace aktivní)
- `user_agent` (`text`)

### `public.attendance_days`
Denní evidence směn.
- `user_key`, `date` (Složený PK)
- `type` (`CHECK type IN ('work', 'homeOffice', 'businessTrip', 'vacation', 'halfVacation', 'doctor', 'sick', 'holiday', 'compTime', 'other')`)
- `start_time`, `end_time`, `break_minutes`, `worked_minutes`, `credited_minutes`, `target_minutes`, `balance_minutes`, `note`
- `deleted_at` (`timestamptz`, soft tombstone)
- `updated_at` (`timestamptz`)

### `public.attendance_invites`
Pozvánky pro nové uživatele.
- `code` (`text`, PK)
- `created_by` (`text`, FK na admin profil)
- `target_role` (`text`, `'employee'` nebo `'admin'`)
- `is_used` (`boolean`)
- `used_by` (`text`)
- `expires_at` (`timestamptz`)

---

## 4. Ochrana proti Brute-Force útokům

1. **Lockout politika**:
   - Po 5 neúspěšných pokusech: dočasný zámek na **2 minuty**.
   - Po 10 neúspěšných pokusech: dočasný zámek na **15 minut**.
2. **Bezpečnost transakcí (Persistence counteru)**:
   - Funkce `login_attendance_user` **nevyvolává `RAISE EXCEPTION`** při chybném heslu.
   - Tím je zaručeno, že navýšení `failed_login_count` a hodnota `locked_until` se v databázi trvale zapíší (nedojde k vrácení transakce).
   - Návratová hodnota je strukturovaný JSON: `{ "success": false, "error": "invalid_credentials", "message": "..." }`.

---

## 5. Registrace a Inicializace Správce

- **Automatické vytvoření prvního správce (Bootstrap)**:
  Pokud je databáze prázdná (neexistuje žádný profil v `attendance_profiles`), první registrovaný uživatel automaticky získá roli `admin` a nepotřebuje kód pozvánky.
- **Invite-Only model pro další uživatele**:
  Jakmile v systému existuje alespoň jeden profil, každá další registrace striktně vyžaduje platný kód pozvánky vytvořený administrátorem (`INV-...`) a novému uživateli je přiřazena role `employee`.
- **Ochrana proti souběhu (Advisory Lock)**:
  Registrační RPC `register_user_with_invite` používá transakční zámek `pg_advisory_xact_lock`, který garantuje, že ani při současných paralelních registracích do prázdné DB nemohou vzniknout dva administrátoři.
- **Prevence Enumeration útoků**:
  Při registraci do neprázdné DB je kód pozvánky validován před kontrolou existence uživatelského jména. Pokud je pozvánka neplatná nebo chybí, server neprozradí, zda uživatelské jméno již existuje.

---

## 6. Ověření a Testování Bezpečnosti

SQL testy jsou uloženy v:
```text
supabase/tests/security.sql
```
a ověřují:
1. Zákaz přímého zápisu do `attendance_days` a `attendance_profiles` přes REST.
2. Zákaz přístupu k `attendance_credentials` a `attendance_sessions`.
3. Správné fungování atomického LWW upsertu.
4. Trvalé uložení brute-force počítadla při neúspěšném přihlášení.
5. Zamítnutí registrace bez platné pozvánky.

