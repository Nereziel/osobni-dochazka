# Osobní docházka

**v3.1.3 · Vue 3 · Vite · Supabase · PWA**

Jednoduchá webová aplikace pro evidenci osobní docházky. Funguje na počítači i mobilu, lze ji nainstalovat jako PWA a po přihlášení pracuje i bez připojení k internetu.

**Aplikace:** https://osobni-dochazka.pages.dev/

## Funkce

- příchod, odchod, pracovní doba a přestávky
- měsíční fond, odpracovaný čas a saldo
- dovolená, půlden dovolené, nemoc, lékař, home office, služební cesta a další typy absence
- české státní svátky
- vlastní pracovní dny a pracovní doba včetně víkendů
- offline režim přes IndexedDB
- automatická synchronizace mezi zařízeními
- instalovatelná PWA s upozorněním na novou verzi
- více uživatelů, role správce a pozvánky pro nové uživatele

## Technologie

- **Vue 3**
- **Vite 8**
- **Supabase / PostgreSQL**
- **IndexedDB** pro lokální offline data
- **Workbox / vite-plugin-pwa**
- **Vitest + ESLint**
- **Cloudflare Pages + Pages Functions**
- **GitHub Actions** pro CI a pravidelný security scan
- **Dependabot** pro kontrolu aktualizací závislostí

## Lokální spuštění

Požadován je **Node.js 22.12 nebo novější**.

```bash
npm install
npm run dev
```

Kontrola projektu:

```bash
npm run lint
npm run test
npm run build
npm audit --omit=dev
```

Na Windows lze při blokovaném `npm.ps1` použít například:

```powershell
npm.cmd run test
npm.cmd run build
```

## Supabase a Cloudflare

Browser nekomunikuje se Supabase přímo. Vue posílá požadavky pouze na same-origin `/api/supabase/*`; Cloudflare Pages Function přidá publishable klíč a serverovou attendance session až při volání Supabase.

Pro Pages Functions nastav podle `.env.example` tyto runtime proměnné v **preview i production** prostředí Cloudflare Pages:

```ini
SUPABASE_URL=https://vas-projekt.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_vas-klic
```

`SUPABASE_PUBLISHABLE_KEY` je nízkoprivilegovaný publishable klíč. Privilegovaný `service_role`/secret klíč tato aplikace nepoužívá. Proměnné bez prefixu `VITE_` nejsou součástí Vue browser bundle.

### Inicializace databáze

`supabase/schema.sql` je záměrně ochranný soubor a samostatné spuštění odmítne. Bezpečný stav databáze vzniká pouze aplikací základního schématu a všech migrací v pořadí.

Postup je popsaný v [`supabase/README.md`](./supabase/README.md). Pro novou databázi se aktuálně používá:

```text
supabase/schema_base.sql
supabase/migrations/20261102_security_hardening.sql
supabase/migrations/20261102_security_audit_followup.sql
supabase/migrations/20261102_security_stepup_compat.sql
supabase/migrations/20261102_admin_audit_read.sql
```

Veřejná registrace je vždy **invite-only**. První administrátor se nevytváří automaticky přes veřejnou aplikaci; musí být založen důvěryhodným administrátorským postupem mimo veřejný registrační endpoint.

## Synchronizace a bezpečnost

Aplikace používá vlastní session systém nad Supabase:

- PIN/heslo je na serveru hashováno pomocí bcrypt
- session tokeny jsou kryptograficky náhodné a v databázi se ukládá pouze jejich hash
- raw session token je v browseru pouze v `HttpOnly; Secure; SameSite=Strict` host cookie a není dostupný JavaScriptu
- Cloudflare Pages Function přidává `X-Attendance-Session` až do upstream požadavku na Supabase
- browserová síťová komunikace s datovou vrstvou je omezena na same-origin `/api/*`
- přístup k datům omezuje PostgreSQL Row Level Security
- zápisy docházky a nastavení probíhají přes kontrolované RPC funkce
- odvozené hodnoty docházky se přepočítávají na serveru
- kritické administrátorské operace vyžadují opětovné ověření admin PINu
- login používá databázový rate limiting podle zdrojové IP a účtu
- bezpečnostní administrátorské akce se zapisují do neveřejného audit logu a správce je může číst přes vyhrazené read-only RPC
- synchronizace je offline-first s outbox frontou, tombstones a serverovým Last-Write-Wins
- aplikace po návratu online automaticky odešle čekající změny a stáhne novější data

Podrobnosti k autentizaci jsou v [`docs/AUTH.md`](./docs/AUTH.md).

Backup a recovery postup je v [`docs/BACKUP_RECOVERY.md`](./docs/BACKUP_RECOVERY.md). Produkční databázové dumpy se nesmí commitovat do tohoto veřejného repozitáře.

### Automatická bezpečnostní kontrola repozitáře

Samostatný workflow `.github/workflows/security.yml` běží automaticky jednou týdně a lze jej spustit i ručně v GitHub Actions. Kontroluje:

- zdrojový JavaScript/Vue kód pomocí GitHub CodeQL se sadou `security-extended`,
- všechny npm závislosti pomocí `npm audit --audit-level=high`,
- omylem trackované `.env`, privátní klíče/certifikátové exporty a databázové zálohy,
- celé PostgreSQL/Supabase bezpečnostní regresní testy.

CodeQL nálezy se zobrazují v GitHub **Security → Code scanning**. Ostatní kontroly jsou vidět v běhu workflow **Security** v GitHub Actions. Tento pravidelný scan není required merge check; běžné PR nadále blokují stávající `Test and build` a `Database security` kontroly.

## Nasazení

Produkce běží na Cloudflare Pages a nasazuje se automaticky z větve `main`.

Build nastavení:

```text
Build command: npm run build
Output directory: dist
```

V Cloudflare Pages musí být pro **production i preview Pages Functions** nastavené:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Volitelná browserová build-time konfigurace, například `VITE_SYNC_INTERVAL_MS`, používá prefix `VITE_`. Supabase URL ani klíč se do browserové konfigurace nevkládají.

Pull requesty procházejí JavaScriptovým i databázovým bezpečnostním CI. Dependabot sleduje npm balíčky i GitHub Actions.

## Licence

Projekt používá licenci **PolyForm Noncommercial 1.0.0**. Viz [`LICENSE`](./LICENSE).
