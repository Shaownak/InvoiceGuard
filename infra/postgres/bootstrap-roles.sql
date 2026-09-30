-- Creates (or updates) the two login roles InvoiceGuard uses. Run once per cluster as a
-- superuser, BEFORE creating the database and running migrations.
--
--   ig_owner  owns the database and all objects; runs migrations (DATABASE_OWNER_URL).
--   ig_app    used by web and worker (DATABASE_URL). Not superuser, cannot bypass RLS,
--             owns nothing, and gets DML rights only through migration-defined grants.
--
-- Passwords are never written in this file. The caller sets them as session settings first:
--   SELECT set_config('ig.owner_password', '<pw>', false);
--   SELECT set_config('ig.app_password', '<pw>', false);
-- Used by infra/postgres/init/10-bootstrap.sh (Docker) and tools/devinfra (native mode, tests).

DO $bootstrap$
DECLARE
  role_attrs constant text := 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ig_owner') THEN
    EXECUTE format('CREATE ROLE ig_owner %s PASSWORD %L', role_attrs, current_setting('ig.owner_password'));
  ELSE
    EXECUTE format('ALTER ROLE ig_owner %s PASSWORD %L', role_attrs, current_setting('ig.owner_password'));
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ig_app') THEN
    EXECUTE format('CREATE ROLE ig_app %s PASSWORD %L', role_attrs, current_setting('ig.app_password'));
  ELSE
    EXECUTE format('ALTER ROLE ig_app %s PASSWORD %L', role_attrs, current_setting('ig.app_password'));
  END IF;
END
$bootstrap$;
