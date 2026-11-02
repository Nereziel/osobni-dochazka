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

## Existující databáze

Pokud už databáze obsahuje základní schéma a předchozí migrace, **nespouštěj `schema_base.sql` znovu**. Spusť pouze nové migrace, které v databázi ještě nejsou aplikované.

## Bezpečnostní testy

CI po aplikaci schématu a migrací spouští:

- `supabase/tests/security_hardening.sql`
- `supabase/tests/security_audit_followup.sql`

Tyto testy běží v transakci a po skončení změny vracejí zpět.
