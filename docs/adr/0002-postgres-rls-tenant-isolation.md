# ADR-0002: Postgres row-level security for tenant isolation; `withOrg` is the only entry point

- Status: Accepted (foundations in M0; tables, policies and `withOrg` in M1). Amended by
  [ADR-0015](0015-database-access-contexts.md): RLS on every table, ENABLE without FORCE.
- Date: 2026-09-30
- Source: ARCHITECTURE.md section 15, item 2

## Context

Customers upload financial documents and bank details. A single cross-tenant read would be a
breach. Filtering by `org_id` in application code alone fails the moment one query forgets
the filter.

## Decision

Isolation is enforced by the database, with application filtering as a second layer:

1. Every tenant table has `org_id NOT NULL`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a
   policy `USING (org_id = current_setting('app.org_id', true)::uuid)` plus matching
   `WITH CHECK`. An unset setting yields no rows rather than an error.
2. Two roles (M0, `infra/postgres/bootstrap-roles.sql`):
   - `ig_owner` owns the schema and runs migrations.
   - `ig_app` is used by web and worker: `NOSUPERUSER NOBYPASSRLS`, owns nothing, has no DDL,
     and receives DML only through default privileges from the baseline migration.
3. `withOrg(orgId, fn)` in `packages/db` opens a transaction, runs
   `set_config('app.org_id', $1, true)` (transaction-local, safe with connection pooling), and
   hands `fn` a scoped handle. It is the only way app code obtains a tenant DB handle.
4. Raw `pg` / Drizzle driver imports are an ESLint error outside `packages/db`.

## Verification

- M0: an integration test asserts `ig_app` is not superuser, cannot bypass RLS, is not a
  member of `ig_owner`, and cannot create tables or schemas (`packages/db/src/baseline.int.test.ts`).
- M1: a cross-tenant suite runs select/insert/update/delete as org B against org A rows for
  every table, and a test enumerates all tables with an `org_id` column and fails if any lacks
  a policy.

## Consequences

- Forgetting an `org_id` filter returns nothing instead of leaking data.
- Cross-org operations (a user listing their memberships, platform admin) need explicit,
  reviewed paths (policy on `user_id` or a `SECURITY DEFINER` function), decided in M1.
