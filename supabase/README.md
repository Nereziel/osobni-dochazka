# Supabase databáze

`supabase/schema.sql` je záměrně ochranný soubor a **nesmí se používat pro inicializaci databáze**. Jeho spuštění skončí chybou, aby nešlo omylem vytvořit starou před-hardening konfiguraci.

## Nová databáze

V Supabase SQL Editoru spusť v tomto pořadí:

1. `supabase/schema_base.sql`
2. `supabase/migrations/20261102_security_hardening.sql`
3. `supabase/migrations/20261102_security_audit_followup.sql`
4. `supabase/migrations/20261102_security_stepup_compat.sql`

Migrace aplikuj vždy v pořadí podle názvu souboru. CI používá stejný postup.

Po inicializaci není veřejný bootstrap prvního správce. Prvního administrátora je nutné založit mimo veřejnou aplikaci přímo v databázi nebo jiným důvěryhodným administrátorským postupem. Běžná registrace je vždy pouze přes jednorázovou pozvánku.

## Existující produkční databáze

Pokud databáze už obsahuje `20261102_security_hardening.sql`, **nespouštěj `schema_base.sql` znovu**.

Pro auditní hardening z 2. 11. 2026 lze v Supabase SQL Editoru spustit jediný připravený soubor:

```text
supabase/manual/20261102_security_audit_production.sql
```

Tento bundle obsahuje přesně následné změny z `20261102_security_audit_followup.sql` a `20261102_security_stepup_compat.sql`. CI jej ověřuje samostatně na čisté databázi, která nejprve dostane základní schéma a předchozí hardening migraci.

## Bezpečnostní testy

Jednotný runner je:

```text
supabase/tests/security.sql
```

Ten spouští:

- `security_hardening.sql`
- `security_audit_followup.sql`
- `security_isolation.sql`

Testy běží v transakcích a po skončení změny vracejí zpět.
