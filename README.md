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

### 3. Sestavení produkčního buildu
```bash
npm run build
```
Statický build se vygeneruje do složky `./dist`.

### 4. Spuštění testů
```bash
npm run test
```
Spustí jednotkové testy v prostředí **Vitest** (testování výpočtů, absencí, českých svátků, časových převodů, outboxu a konfliktů).

---

## 🛠️ Architektura a technologie

- **Frontend framework**: Vue 3 (Composition API s `<script setup>`)
- **Build nástroj**: Vite (s bází `/osobni-dochazka/`)
- **PWA**: `vite-plugin-pwa` s Workbox serviceworkerem, offline shell a automatickým promptem pro aktualizaci nové verze
- **Lokální databáze**: IndexedDB (verze 4) s rozdělením dat podle uživatele `[userId, date]`, per-user nastavením a perzistentní frontou změn (Outbox queue)
- **Backend / Databáze**: Supabase (PostgreSQL, Row Level Security, RPC funkce)
- **Testy**: Vitest pro rychlé a přesné testování business logiky bez DOM závislostí

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

### SQL migrace
Všechny SQL skripty jsou uloženy v adresáři [`supabase/migrations/`](./supabase/migrations/):

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
   - Přidává sloupec `deleted_at timestamptz` a indexy pro offline mazání (tombstones) bez rizika nechtěného znovustažení smazaného dne.

---

## 📦 Nasazení na GitHub Pages

Deploy na GitHub Pages je plně automatizovaný přes GitHub Actions workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):

1. Při pushi do větve `main` workflow spustí:
   - `npm ci`
   - `npm run test` (ověří správnost výpočtů před nasazením)
   - `npm run build` (sestaví aplikaci s klíči ze Secrets)
   - Publikuje složku `./dist` na GitHub Pages
2. **Nastavení GitHub Secrets**:
   - V repozitáři přejděte do **Settings → Secrets and variables → Actions**.
   - Přidejte:
     - `SUPABASE_URL`: URL adresa Supabase projektu
     - `SUPABASE_ANON_KEY`: Veřejný anon klíč projektu
   - V **Settings → Pages** vyberte Source: **GitHub Actions**.

---

## 🔄 Migrace ze staré verze (Vanilla JS na Vue 3)

### Co se stane se stávajícími daty?
- **Supabase**: Data v tabulkách `attendance_profiles`, `attendance_days` a `attendance_invites` zůstávají 100% zachována. Žádné tabulky se nemažou ani netruncují.
- **IndexedDB**:
  - Stará verze používala databázi verze 3 s klíčem podle `date`.
  - Nová aplikace automaticky upgraduje IndexedDB na verzi 4.
  - Všechny existující dny a nastavení se automaticky převedou do per-user úložiště (`[userId, date]` a `user_settings`).
- **Offline DELETE fronta**:
  - Pokud uživatel smaže den offline, uloží se záznam o smazání do persistentní `sync_queue` (Outbox).
  - Při obnovení spojení se nejdříve provede smazání v cloudu, takže se smazaný den nikdy nevrátí.
- **PWA Service Worker**:
  - `vite-plugin-pwa` automaticky detekuje novou verzi a nabídne uživateli lištu **„Je dostupná nová verze aplikace – Aktualizovat“**. Stará cache se bezpečně vyčistí.
