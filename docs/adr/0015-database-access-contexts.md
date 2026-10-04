# ADR-0015: Database access contexts, RLS on every table, and SECURITY DEFINER lookups

- Status: Accepted
- Date: 2026-09-30
- Resolves: spec issue C7 (memberships/invites "not RLS" vs CLAUDE.md rule 3)
- Amends: ADR-0002 (no `FORCE ROW LEVEL SECURITY`; see below), ARCHITECTURE.md section 5
  ("users and memberships are not tenant-scoped by RLS") and section 4 (`users.password_hash`)

## Context

ADR-0002 makes Postgres RLS the tenant boundary, with `withOrg(orgId, fn)` as the only entry
point. M1 adds identity data that does not fit a single-org context:

- a user lists their orgs (org switcher) and creates new ones;
- login, magic links, password reset and invite links must find a user, session, token or
  invite before anyone is authenticated;
- members of an org must see each other's names and emails, but not other tenants' users.

ARCHITECTURE.md section 5 left users and memberships outside RLS, "only reachable through auth
helpers". That relies on app code discipline, which is exactly what RLS exists to replace, and
it contradicts CLAUDE.md rule 3 and the enumeration test for `memberships` and `invites`.

## Decision

1. **RLS is enabled on every table in `public`**, not only tables with `org_id`. The app role
   (`ig_app`) sees a row only through a context set by `packages/db`:
   - `app.org_id`: the tenant. Every `org_id` table is limited to `org_id = app_org_id()`.
   - `app.user_id`: the acting user. `users`, `user_credentials`, `sessions` and `auth_tokens`
     are limited to that user; `users` also shows co-members of the current org.
   - `memberships` additionally lets a user read their own rows in other orgs (read-only,
     listed as a reviewed exception in the enumeration test); `organizations` shows the current
     org plus orgs the user belongs to. Writes stay limited to the current org.
   - With no context, the app role sees nothing (tested for every table).
2. **Three entry points** in `packages/db`, and the pool stays private:
   - `withOrg(orgId, fn, { userId })` for tenant work (requests and jobs);
   - `withUser(userId, fn)` for the user's own rows outside an org;
   - `db.auth`, a gateway over **six SECURITY DEFINER functions** that are the only paths that
     act without a context: `auth_find_user_by_email`, `auth_register_user`,
     `auth_session_lookup`, `auth_consume_token`, `invite_lookup`, `create_organization`
     (which requires `app.user_id` and makes that user the owner atomically). They take hashed
     tokens, return the minimum, pin `search_path` with `pg_temp` last, and are executable only
     by `ig_app`. The enumeration test fails on any other definer function.
     Context values are set with `set_config(..., true)` (transaction-local) through bound
     parameters. `app_org_id()`/`app_user_id()` use `NULLIF(..., '')` because a pooled
     connection reports `''` after a context transaction ends. An ESLint rule forbids naming
     `app.org_id`/`app.user_id` anywhere outside `packages/db`.
3. **Password hashes live in `user_credentials`**, not `users`, so the co-member read on
   `users` can never expose them, however a member list query is written.
4. **Privileges narrow further**: the app role cannot INSERT/DELETE `organizations` or
   `users` (definer functions only), may UPDATE only `users(name, email_verified_at)`, cannot
   UPDATE/DELETE `auth_tokens` or `audit_log`, and has TRUNCATE on nothing (RLS does not
   govern TRUNCATE; tested for every table).
5. **A session's active org is a composite foreign key** `(active_org_id, user_id)` to
   `memberships(org_id, user_id)` `ON DELETE SET NULL (active_org_id)`: a session can only point
   at an org its user belongs to, and removing a member drops them out of that org at once.
6. **No `FORCE ROW LEVEL SECURITY`** (ADR-0002 item 1 said ENABLE and FORCE). FORCE would bind
   the table owner, and the definer functions run as the owner; keeping them working under
   FORCE needs a separate `BYPASSRLS` role, which only a superuser can create, so existing
   databases would need a manual bootstrap step. What FORCE protects against is the app
   connecting as the owner by mistake. That is covered instead by `Database.ping()`, used
   by readiness: it fails when the connected role is superuser, `BYPASSRLS`, or a member of
   `ig_owner`, so a misconfigured deployment reports unhealthy (tested).

## Verification

`packages/db/src/rls.int.test.ts`:

- enumeration: every table has RLS; every policy on an `org_id` table checks `app_org_id()`
  (one reviewed exception); every other policy is bound to a context; no view without
  `security_invoker`; no unreviewed definer function; a meta-test proves each check fires;
- every `org_id` table must register a fixture, and for each one org B tries SELECT (with and
  without filters), UPDATE (touch, steal, move), DELETE (by id and unfiltered) and INSERT into
  org A; org A's row is compared byte-for-byte afterwards;
- `organizations`, and the identity tables across users;
- `withOrg` through Drizzle: unfiltered queries return only the current org; no context leaks
  to the next transaction on the same pooled connection.

`packages/db/src/auth-gateway.int.test.ts` covers each definer function.

## Consequences

- A query that forgets its `org_id` or `user_id` filter returns nothing extra.
- A new table must enable RLS with context-bound policies, and a new tenant table must add a
  cross-tenant fixture, or `pnpm check` fails.
- New pre-authentication needs (for example SSO) mean a new reviewed definer function and an
  entry in `REVIEWED_DEFINER_FUNCTIONS`.
