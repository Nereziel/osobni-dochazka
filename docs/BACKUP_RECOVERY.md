# Supabase backup a recovery runbook

Aktualizováno: 2026-11-02

Tento dokument popisuje bezpečný postup zálohy a obnovy databáze pro projekt Osobní docházka. Produkční data se nesmí ukládat do veřejného GitHub repozitáře.

## Doporučený model ochrany

Používej dvě nezávislé vrstvy:

1. **Platformní zálohy Supabase**, pokud je daný projekt/plan podporuje.
2. **Ruční logická záloha před každou významnou databázovou migrací** a pravidelně podle potřeby.

Podle aktuální dokumentace Supabase:

- Free: automatické zálohy nejsou garantovanou součástí plánu; používej vlastní `supabase db dump`.
- Pro: denní zálohy s retencí 7 dní.
- Team: denní zálohy s retencí 14 dní.
- Enterprise: denní zálohy až 30 dní.
- PITR (Point-in-Time Recovery) je placená možnost pro jemnější obnovu na konkrétní časový bod.

Stav konkrétního projektu vždy ověř v Supabase Dashboardu v **Database → Backups**.

Oficiální dokumentace:

- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/deployment/ci/backups

## Ruční záloha před migrací

### 1. Připrav connection string

V Supabase Dashboardu otevři **Connect** a vezmi direct connection string nebo Session Pooler connection string.

Connection string neukládej do repozitáře. V PowerShellu jej nastav pouze do proměnné prostředí aktuálního procesu:

```powershell
$env:SUPABASE_DB_URL = 'postgresql://...'
```

Pozor: connection string obsahuje databázové heslo.

### 2. Spusť připravený backup skript

Z kořene projektu:

```powershell
.\scripts\backup-supabase.ps1
```

Vznikne například:

```text
backups/
  20261102-140000/
    roles.sql
    schema.sql
    data.sql
    SHA256SUMS.txt
```

Adresář `backups/` je v `.gitignore`.

Skript používá oficiální Supabase CLI postup:

```text
supabase db dump --role-only
supabase db dump
supabase db dump --data-only --use-copy
```

### 3. Ulož druhou kopii mimo počítač

Minimálně jednu kopii ulož mimo pracovní PC, například do šifrovaného firemního úložiště nebo šifrovaného externího média.

Záloha obsahuje produkční osobní data. Neposílej ji do veřejného GitHub repozitáře, veřejného cloudového odkazu ani nezašifrovaného sdíleného úložiště.

## Kontrola zálohy

Po vytvoření zálohy ověř:

- `roles.sql`, `schema.sql` a `data.sql` existují a nejsou prázdné,
- `SHA256SUMS.txt` existuje,
- velikost `data.sql` odpovídá tomu, že databáze skutečně obsahuje data,
- soubory lze přečíst a nejsou nulové velikosti.

Před kritickou změnou databáze je vhodné mít novou zálohu vytvořenou ve stejný den.

## Obnova přes Supabase Dashboard

Pokud má projekt dostupnou platformní zálohu:

1. Otevři **Database → Backups**.
2. Vyber poslední vhodnou zálohu před incidentem.
3. Pokud je dostupná možnost **Restore to a New Project**, preferuj ji pro ověření dat před zásahem do produkce.
4. Teprve po kontrole obnovy rozhodni o přepnutí produkce nebo in-place restore.

Při in-place restore počítej s nedostupností projektu během obnovy.

Databázové zálohy Supabase neobsahují samotné objekty uložené přes Storage API, pouze jejich databázová metadata. Pokud aplikace v budoucnu začne používat Supabase Storage, musí mít objekty vlastní zálohovací postup.

## Obnova z logické zálohy do nového projektu

Doporučený recovery test dělej do **nového Supabase projektu**, ne přímo přes produkční databázi.

1. Vytvoř nový Supabase projekt.
2. Zapni stejné potřebné PostgreSQL extensions.
3. Zkopíruj connection string nového projektu.
4. Proveď obnovu:

```powershell
$env:RESTORE_DB_URL = 'postgresql://...'

psql `
  --single-transaction `
  --variable ON_ERROR_STOP=1 `
  --file roles.sql `
  --file schema.sql `
  --command 'SET session_replication_role = replica' `
  --file data.sql `
  --dbname $env:RESTORE_DB_URL
```

Pokud používáš shell místo PowerShellu, použij ekvivalentní syntaxi z oficiálního Supabase návodu.

## Kontrola po obnově

Před použitím obnovené databáze zkontroluj minimálně:

```sql
select count(*) from public.attendance_profiles;
select count(*) from public.attendance_days;
select count(*) from public.attendance_invites;
select count(*) from public.attendance_audit_log;
```

Dále ověř:

- RLS je zapnuté na citlivých tabulkách,
- `attendance_credentials` a `attendance_sessions` nejsou přímo dostupné rolím `anon`/`authenticated`,
- admin RPC fungují pouze s platnou admin session,
- `admin_list_audit_log()` funguje pouze správci,
- přihlášení a synchronizace docházky fungují,
- serverové výpočty docházky stále ignorují podvržené klientské součty.

Pro kontrolu schématu lze znovu spustit databázové security testy z `supabase/tests/` nad testovací/restored DB.

## Session po obnově

Po **každé produkční obnově** zneplatni všechny session uložené v obnoveném snapshotu. Obnovená databáze může obsahovat session, které byly po okamžiku zálohy mezitím odhlášené, revokované nebo kompromitované.

```sql
update public.attendance_sessions
set revoked_at = now()
where revoked_at is null;
```

Uživatelé se následně znovu přihlásí. Tento krok je zvlášť důležitý při obnově po bezpečnostním incidentu.

Pokud došlo k úniku databázového hesla nebo privilegovaného Supabase klíče, samotná obnova databáze nestačí — je nutné uniklé přihlašovací údaje/klíče rotovat.

## Doporučený provozní režim

- před každou ruční produkční SQL migrací: nová logická záloha,
- pravidelně: kontrola, že platformní zálohy vznikají podle používaného plánu,
- alespoň občas: test obnovy do samostatného projektu nebo lokálního PostgreSQL/Supabase prostředí,
- po změnách backup/recovery procesu: aktualizovat tento runbook.


## Import lokální JSON zálohy v aplikaci

Volba **Import zálohy** v nastavení používá bezpečné **sloučení** (merge), nikoli
destruktivní nahrazení všech dat. Před otevřením zapisovací transakce ověří
strukturu souboru, data, časy a nastavení. Záznamy se shodným datem se nahradí
obsahem zálohy; dny, které v záloze nejsou, zůstanou zachované.

Importovaná docházka, volitelná nastavení a neodeslané požadavky pro cloud
se zapisují do jedné IndexedDB transakce. Pokud transakce selže, nemá se
provést částečný import. U přihlášeného účtu pokračuje synchronizace a při
konfliktu se serverem zůstane lokální změna v outboxu pro ruční vyřešení.

**Pozor:** Import nepředstavuje bodovou obnovu celé cloudové databáze ani
neodstraňuje cloudové dny, které v JSON souboru nejsou. Pro úplnou obnovu
serveru použij databázovou zálohu a postup výše.
