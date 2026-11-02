-- SECURITY GUARD
--
-- This repository no longer supports initializing Supabase by running this
-- file alone. The historical base schema intentionally remains in
-- supabase/schema_base.sql and MUST be followed by every SQL migration in
-- supabase/migrations/ in filename order.
--
-- Running only the old base schema would recreate pre-hardening behavior.
-- See supabase/README.md for the supported installation procedure.

do $$
begin
  raise exception 'Do not run supabase/schema.sql alone. Follow supabase/README.md: apply schema_base.sql and every migration in order.';
end $$;
