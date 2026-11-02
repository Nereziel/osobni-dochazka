-- Unified security regression runner.
-- Run with psql after schema_base.sql and all current migrations.
-- Individual suites use BEGIN/ROLLBACK and leave no test data behind.

\set ON_ERROR_STOP on
\ir security_hardening.sql
\ir security_audit_followup.sql
\ir security_isolation.sql
\ir security_audit_ui.sql
