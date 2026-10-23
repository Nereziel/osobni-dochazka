# Osobní docházka – PWA pro mobil i prohlížeč (GitHub Pages + Supabase)

Moderní responzivní aplikace pro evidenci pracovní doby, směn, víkendů a dovolených. Funguje jak na **mobilu (iPhone / Android PWA)**, tak ve **webovém prohlížeči na počítači** (s postranním panelem a kompletním měsíčním výkazem).

Data se ukládají lokálně do **IndexedDB** (funguje 100% offline) a zároveň je lze napojit na **jednu společnou Supabase databázi**, kde má každý uživatel svůj jednoduchý login (**Jméno + PIN/heslo**), vlastní nastavení pracovní doby, víkendů i docházku.

## Co aplikace umí

- **Mobilní i Desktopové UI**:
  - Na telefonu rychlé spodní menu, spodní vysouvací karty a rychlé čipování příchodu/odchodu.
  - Na počítači plnohodnotný dashboard s levým postranním panelem, týdenním pásem, velkým kalendářem a tisknutelným měsíčním výkazem.
- **Individuální nastavení pracovní doby a víkendů**:
  - Běžný příchod, odchod, denní fond (s možností automatického výpočtu) a automatická přestávka.
  - **Práce o víkendu**: výběr pracovních dnů v týdnu (`Po–Pá`, `Po–So`, `Po–Ne` nebo vlastní kombinace dnů).
  - Možnost nastavit **odlišnou pracovní dobu a fond pro víkend** (So/Ne) a přepínač **Práce ve státní svátky**.
  - Sledování ročního nároku a čerpání dovolené.
- **Jednoduchý login + 1 společná Supabase databáze**:
  - Každý uživatel se přihlásí svým `uživatelským jménem` a `PINem/heslem`.
  - Jeho rozvrh (běžná pracovní doba, víkendy, svátky) i denní záznamy docházky se automaticky synchronizují mezi mobilem a prohlížečem.
- **Režimy dne**:
  - Práce, Home office, Služební cesta, Dovolená, ½ dovolené, Lékař / Propustka, Nemoc, Náhradní volno, Svátek, Jiné omluvené volno.
- **Exporty a výkazy**:
  - Hromadné doplnění běžné pracovní doby do nevyplněných pracovních dnů v měsíci jedním klikem.
  - Export měsíčního výkazu do **CSV (Excel)**, **Tisk / PDF výkaz** a kompletní **JSON záloha**.

## Jak nastavit společnou Supabase databázi a GitHub Secrets

1. Vytvoř si projekt zdarma na [https://supabase.com](https://supabase.com).
2. V levém menu otevři **SQL Editor → New query**, vlož obsah souboru [`supabase-schema.sql`](./supabase-schema.sql) (nebo ho zkopíruj přímo v aplikaci v **Nastavení → SQL Návrh databáze**) a klikni na **Run**.
3. V **Project Settings → API** zkopíruj `Project URL` a `anon public` klíč (nikdy nepoužívej `service_role` klíč).
4. **Uložení klíčů do GitHub Secrets (doporučeno pro GitHub Pages)**:
   - Ve svém GitHub repozitáři otevři **Settings → Secrets and variables → Actions → New repository secret**.
   - Vytvoř secret `SUPABASE_URL` (hodnota tvé Project URL) a secret `SUPABASE_ANON_KEY` (hodnota tvého `anon public` klíče).
   - V **Settings → Pages** přepni **Source** na **GitHub Actions**.
   - Připravený workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) při každém nahrání do GitHubu automaticky vloží klíče ze Secrets do [`config.js`](./config.js) a publikuje aplikaci na GitHub Pages, aniž bys musel klíče zapisovat přímo do zdrojového kódu v repozitáři.
5. **Bezpečnost na straně databáze (RLS)**:
   - Protože GitHub Pages je statický hosting a prohlížeč s databází komunikuje přímo, [`supabase-schema.sql`](./supabase-schema.sql) obsahuje striktní **Row Level Security (RLS)** politiky (`req_user_key()` a `req_pin_hash()`).
   - Databáze při každém dotazu kontroluje shodu uživatelského jména i zahashovaného PINu přímo v PostgreSQL – nikdo tak nemůže číst ani upravovat záznamy jiného uživatele, i kdyby v prohlížeči viděl veřejný `anon` klíč.

## Publikace na GitHub Pages

1. Nahraj všechny soubory (`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `supabase-schema.sql` a ikony) do svého GitHub repozitáře.
2. V **Settings → Pages** nastav **Deploy from a branch** (`main` / `root`).
3. Aplikace okamžitě běží na `https://tve-jmeno.github.io/nazev-repozitare/`.
