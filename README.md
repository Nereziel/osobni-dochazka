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

## 📜 Inicializace databáze v Supabase

Veškerá struktura databáze je uceleně definována v jediném souboru [`supabase/schema.sql`](./supabase/schema.sql).

Tento skript obsahuje:
- **Rozšíření `pgcrypto`**: Pro bezpečné generování náhodných session tokenů a bcrypt hashování PINu.
- **Oddělení citlivých tabulek**: Veřejný profil v `attendance_profiles`, privátní přihlašovací údaje v `attendance_credentials`, relace v `attendance_sessions`.
- **Zákaz přímého zápisu přes REST**: Zápis docházky probíhá přes RPC `upsert_attendance_day_lww` a nastavení přes RPC `update_own_settings`.
- **Pohled `v_monthly_attendance_summary`**: S volbou `security_invoker = true` pro respektování RLS politik a kanonickými typy docházky.
- **Session systém**: Ověřování relací přes HTTP hlavičku `X-Attendance-Session`, serverový lockout counter s garancí uložení.
- **Invite-only registrace**: Registrace nových uživatelů vyžaduje platný kód pozvánky. První administrátor se inicializuje skriptem [`supabase/bootstrap_admin.sql`](./supabase/bootstrap_admin.sql).
- **Atomický LWW upsert**: RPC funkce `upsert_attendance_day_lww` pro spolehlivou synchronizaci a řešení souběžných konfliktů.
- **Row Level Security (RLS)**: Striktní autorizace pro všechny operace.

Pro inicializaci nebo čistý restart stačí obsah [`supabase/schema.sql`](./supabase/schema.sql) vložit do **Supabase SQL Editoru** a spustit, následovaný spuštěním [`supabase/bootstrap_admin.sql`](./supabase/bootstrap_admin.sql).

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
