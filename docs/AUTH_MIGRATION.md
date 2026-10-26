# Architektura autentizace: Vlastní Session systém s bcrypt (Bez Supabase Auth)

> **STAV: DOKONČENO / SUPABASE AUTH SE NEPOUŽÍVÁ**
> Původní záměr migrovat na oficiální Supabase Auth (e-mail, heslo, magic linky) byl zrušen.
> Uživatel nepotřebuje e-mail ani Supabase Auth účet. Přihlašování probíhá výhradně kombinací `username + PIN`.

---

## 1. Cílová architektura autentizace

```text
username + PIN
      ↓
login RPC (login_attendance_user)
      ↓
server ověří PIN (bcrypt / automatická jednorázová migrace stávajících uživatelů)
      ↓
server vygeneruje kryptograficky náhodný 256-bitový session token
      ↓
server uloží SHA-256 hash tokenu do public.attendance_sessions
      ↓
klient obdrží RAW session token a ukládá jej do localStorage / sessionStorage
      ↓
další API requesty odesílají HTTP hlavičku X-Attendance-Session: <token>
      ↓
PostgreSQL z tokenu bezpečně odvodí identitu uživatele (current_session_user_key()) a RLS
```

---

## 2. Klíčové bezpečnostní vlastnosti

1. **Žádný bearer PIN hash**:
   - Ani PIN, ani jeho hash (`pin_hash`) se neposílá jako přenositelný bearer credential v běžných API požadavcích.
   - PIN slouží pouze k prvotnímu přihlášení nebo změně PINu.

2. **Opaque Random Session Token**:
   - Token má 256 bitů entropie vygenerovaných přes PostgreSQL `pgcrypto.gen_random_bytes(32)`.
   - V databázi je uložen výhradně SHA-256 otisk tokenu (`token_hash`).
   - Server tak při úniku databáze nevystaví platné přihlašovací relace.

3. **Bcrypt hashování na serveru**:
   - Hesla/PINy jsou na serveru chráněny pomalou hashovací funkcí `crypt(pin, gen_salt('bf', 10))`.

4. **Plynulá migrace existujících uživatelů bez ztráty dat**:
   - Stávající účty mají v databázi sloupec `auth_version = 1`.
   - Při prvním přihlášení server ověří zadaný PIN proti původnímu SHA-256 otisku.
   - Ihned po ověření server automaticky zahashuje PIN přes bcrypt, přepne účet na `auth_version = 2`, vymaže legacy otisk a vystaví session token.
   - Uživatel nemusí resetovat heslo ani znovu zakládat účet.

5. **Ochrana proti Brute-Force útokům**:
   - Čítač neúspěšných pokusů (`failed_login_count`).
   - Po 5 neúspěšných pokusech je účet dočasně uzamčen na 1 minutu.
   - Po 10 neúspěšných pokusech je účet uzamčen na 5 minut.

6. **Revokace relací**:
   - Uživatel se může kdykoliv odhlásit (`logout_attendance_session`), což relaci serverově zneplatní (`revoked_at = now()`).
   - K dispozici je možnost odhlásit všechna ostatní zařízení.
