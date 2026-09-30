-- Baseline: extensions, privilege model, and the UUID v7 generator.
-- Runs as ig_owner (database owner). Roles themselves are created by
-- infra/postgres/bootstrap-roles.sql, before any migration.

-- Trusted extensions (PG13+): creatable by the database owner without superuser.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- Privilege model: only ig_app may connect besides the owner; nobody else may create objects
-- in public. ig_app gets DML on future tables through default privileges, and never owns
-- anything, so row-level security always applies to it (ARCHITECTURE.md section 5).
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ig_app', current_database());
END
$$;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ig_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ig_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ig_app;
--> statement-breakpoint

-- UUID v7 (RFC 9562): 48-bit Unix milliseconds, version 7, 74 random bits. Time-ordered keys
-- keep B-tree inserts local. Postgres 16 has no built-in (uuidv7() arrives in PG18).
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  bytes bytea;
BEGIN
  bytes := substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
           || gen_random_bytes(10);
  -- Byte 6 high nibble = version 7; byte 8 high bits = variant 0b10.
  bytes := set_byte(bytes, 6, (b'0111' || get_byte(bytes, 6)::bit(4))::bit(8)::int);
  bytes := set_byte(bytes, 8, (b'10' || get_byte(bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(bytes, 'hex')::uuid;
END
$$;
