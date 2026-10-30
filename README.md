# Osobní docházka

**v3.1.3 · Vue 3 · Vite · Supabase · PWA**

Jednoduchá webová aplikace pro evidenci osobní docházky. Funguje na počítači i mobilu, lze ji nainstalovat jako PWA a po přihlášení pracuje i bez připojení k internetu.

**Aplikace:** https://nereziel.github.io/osobni-dochazka/

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
- **GitHub Actions + GitHub Pages**
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

## Supabase

Vytvoř `.env` podle `.env.example`:

```ini
VITE_SUPABASE_URL=https://vas-projekt.supabase.co
VITE_SUPABASE_ANON_KEY=vas-anon-public-klic
```

> Používej pouze veřejný Supabase anon/publishable klíč. `service_role` klíč do klientské aplikace nepatří.

Kompletní databázové schéma je v:

```text
supabase/schema.sql
```

Při vytvoření nové databáze stačí schéma spustit v Supabase SQL Editoru. První registrovaný uživatel se stane administrátorem, další registrace vyžadují pozvánku.

## Synchronizace a bezpečnost

Aplikace používá vlastní session systém nad Supabase:

- PIN/heslo je na serveru hashováno pomocí bcrypt
- session tokeny jsou náhodné a v databázi se ukládá pouze jejich hash
- přístup k datům omezuje PostgreSQL Row Level Security
- zápisy docházky a nastavení probíhají přes kontrolované RPC funkce
- synchronizace je offline-first s outbox frontou, tombstones a serverovým Last-Write-Wins
- aplikace po návratu online automaticky odešle čekající změny a stáhne novější data

Podrobnosti k autentizaci jsou v [`docs/AUTH.md`](./docs/AUTH.md).

## Nasazení

GitHub Actions při změně `main` automaticky provede:

```text
npm ci
npm run lint
npm run test
npm run build
```

a následně nasadí obsah `dist/` na GitHub Pages.

Pro produkční build musí být v **Settings → Secrets and variables → Actions** nastavené:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Pull requesty navíc procházejí workflow **Test and build**. Dependabot sleduje npm balíčky i GitHub Actions.

## Licence

Projekt používá licenci **PolyForm Noncommercial 1.0.0**. Viz [`LICENSE`](./LICENSE).
