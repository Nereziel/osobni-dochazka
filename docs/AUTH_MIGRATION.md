# Audit a plán migrace autentizace na Supabase Auth

## 1. Současný stav autentizace

Aplikace v současnosti funguje v **přechodném hybridním režimu**:

- **Stav**: **Pouze připraveno** (migrace na Supabase Auth NENÍ dokončena na klientské straně).
- **Klientská autentizace**:
  - Uživatel se přihlašuje kombinací `username` a `pin`.
  - V klientu se spočte `pinHash = SHA-256(pin + salt)`.
  - Tento `pinHash` se ukládá do lokálního storage a odesílá se v hlavičce `X-Client-Info` (ve formátu `dochazka-app; user_key=user:xxx; pin_hash=yyy`).
  - PostgreSQL funkce `public.req_user_key()` a `public.req_pin_hash()` čtou tuto hlavičku a RLS politiky ověřují rovnost s `attendance_profiles.pin_hash`.
- **Riziko současného PIN hashe**:
  - `pinHash` funguje jako *přenositelný bearer credential* (kdo zná `pinHash`, nepotřebuje znát původní PIN).
  - Je proto striktně zakázáno `pinHash` logovat, vkládat do URL parametrů, chybových hlášek nebo telemetrie.

## 2. Co již bylo na backendu připraveno (v migracích 002 a 006)

1. Do tabulky `attendance_profiles` byl přidán sloupec:
   ```sql
   auth_id uuid references auth.users(id) on delete set null;
   ```
2. Pomocná funkce `public.current_profile_user_key()`:
   - Nejprve testuje `auth.uid()` (oficiální JWT session ze Supabase Auth).
   - Pokud `auth.uid()` existuje a je spárován s profilem, identita je ověřena oficiálním Supabase tokenem.
   - Pouze pokud `auth.uid()` chybí, použije se fallback na `X-Client-Info` s PIN hashem.
3. RPC funkce `public.link_auth_account(p_username text, p_pin_hash text)`:
   - Umožňuje přihlášenému uživateli v Supabase Auth bezpečně spárovat svůj stávající profil a docházku s novým Supabase Auth účtem (nastaví `auth_id = auth.uid()`).
4. Bezpečná funkce `public.is_admin()`:
   - Ověřuje roli 'admin' výhradně u autentizovaného uživatele (přes `auth.uid()` nebo ověřený `pin_hash`).
   - Neobsahuje žádný backdoor pro neověřené uživatele.

## 3. Bezpečný migrační plán na Supabase Auth (bez ztráty účtů a dat)

Pro kompletní přechod na Supabase Auth bez destrukce existujících účtů a dat je nutné provést následující kroky:

### Fáze 1: Backendová příprava (HOTOVO)
- Schéma podporuje `auth_id uuid` a hybridní RLS (jak `auth.uid()`, tak legacy PIN).
- Žádný existující uživatel ani záznam nebyl smazán.

### Fáze 2: Klientské rozhraní pro propojení účtu (Budoucí krok)
- V nastavení profilu (`SettingsView.vue`) přibude volba *"Přejít na zabezpečený účet (Email + Heslo / Magic Link)"*.
- Uživatel zadá svůj e-mail a heslo:
  1. Zavolá se oficiální `supabase.auth.signUp({ email, password })`.
  2. Po úspěšném přihlášení do Supabase Auth se zavolá RPC `link_auth_account(username, pinHash)`.
  3. Profil se trvale prováže s `auth_id = auth.uid()`.
  4. Klient zahodí lokálně uložený `pinHash` a nadále komunikuje výhradně s JWT bearer tokenem Supabase Auth.

### Fáze 3: Přechodné období
- Uživatelé, kteří ještě neprovedli propojení, se mohou nadále přihlašovat svým stávajícím PINem.
- Uživatelé s propojeným účtem se přihlašují přes Supabase Auth.

### Fáze 4: Dokončení a odstavení legacy PIN hlaviček
- Jakmile všichni aktivní uživatelé přejdou na Supabase Auth (nebo po uplynutí migračního termínu), provede se finální SQL migrace:
  1. Odstraní se fallback na `req_pin_hash()` v RLS a `current_profile_user_key()`.
  2. Sloupec `pin_hash` může být vynulován.
  3. Odstraní se hlavička `X-Client-Info` z klienta.

> **UPOZORNĚNÍ:** Do dokončení Fáze 2–4 zůstává legacy PIN autentizace zachována jako zpětně kompatibilní přechodný režim. Žádné účty nesmí být smazány.

