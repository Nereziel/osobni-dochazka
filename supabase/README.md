# Supabase databáze

`supabase/schema.sql` je záměrně ochranný soubor a **nesmí se používat pro inicializaci databáze**. Jeho spuštění skončí chybou, aby nešlo omylem vytvořit starou před-hardening konfiguraci.

## Nová databáze

V Supabase SQL Editoru spusť v tomto pořadí:

1. `supabase/schema_base.sql`
2. `supabase/migrations/20261102_security_hardening.sql`
3. `supabase/migrations/20261102_security_audit_followup.sql`
4. `supabase/migrations/20261102_security_stepup_compat.sql`
5. `supabase/migrations/20261102_admin_audit_read.sql`

Migrace aplikuj **přesně v pořadí uvedeném výše**. Několik souborů sdílí stejné datum, proto se nespoléhej na lexikální řazení názvů. CI používá stejné pořadí.

Po inicializaci není veřejný bootstrap prvního správce. Prvního administrátora je nutné založit mimo veřejnou aplikaci přímo v databázi nebo jiným důvěryhodným administrátorským postupem. Běžná registrace je vždy pouze přes jednorázovou pozvánku.

## Existující produkční databáze

Pokud databáze už obsahuje `20261102_security_hardening.sql`, **nespouštěj `schema_base.sql` znovu**.

Pro auditní hardening z 2. 11. 2026 lze v Supabase SQL Editoru spustit jediný připravený soubor:

```text
supabase/manual/20261102_security_audit_production.sql
```

Tento bundle obsahuje přesně následné změny z `20261102_security_audit_followup.sql` a `20261102_security_stepup_compat.sql`.

Pro read-only zobrazení bezpečnostního auditu v administraci aplikuj následně:

```text
supabase/manual/20261102_admin_audit_read_production.sql
```

CI oba produkční SQL soubory ověřuje samostatně na čisté databázi.

## Bezpečnostní testy

Jednotný runner je:

```text
supabase/tests/security.sql
```

Ten spouští:

- `security_hardening.sql`
- `security_audit_followup.sql`
- `security_isolation.sql`
- `security_audit_ui.sql`

Testy běží v transakcích a po skončení změny vracejí zpět.

## Backup a obnova

Provozní postup je v [`docs/BACKUP_RECOVERY.md`](../docs/BACKUP_RECOVERY.md).

Před významnou produkční SQL migrací vytvoř novou logickou zálohu. Připravený PowerShell skript:

```powershell
.\scripts\backup-supabase.ps1
```

Connection string se předává pouze přes proměnnou prostředí `SUPABASE_DB_URL`; produkční dumpy patří do ignorovaného adresáře `backups/` a nesmí se commitovat do veřejného repozitáře.
