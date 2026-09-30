# ADR-0016: Append-only audit log, scoped to an organization

- Status: Accepted (purge path designed here, implemented in M8)
- Date: 2026-09-30
- Resolves: spec issue C8 (design); FR-ADM-1 (append-only enforced by a trigger)

## Context

FR-ADM-1 requires an append-only audit log enforced by the database. FR-ADM-3 requires full
organization deletion on request, which must eventually remove that org's audit rows too.
ARCHITECTURE.md section 13 lists logins among audited events, but a login happens before an
org is chosen, and `audit_log` is a tenant table (`org_id NOT NULL`).

## Decision

1. **Two layers of protection:**
   - privileges: the app role holds only SELECT and INSERT on `audit_log` (RLS limits both to
     the current org);
   - a trigger, `audit_log_reject_change()`, raises SQLSTATE `IG001` on UPDATE and DELETE
     (row trigger) and TRUNCATE (statement trigger) for **every** role, including the owner.
2. **Writes happen in the caller's transaction** (`recordAudit(tx, entry)`), so an entry
   commits or rolls back with the change it describes.
3. **Every entry belongs to an org.** User-level events are recorded in the org they affect:
   sign-in in the org the session opens, org switches in the target org, password resets in
   each org the user belongs to. Failed sign-ins are not org events; they are rate-limited
   and logged without the email address.
4. **Entries never hold secrets**: no password hashes, tokens, or token hashes, only the
   fields that changed (for example `{ role: 'viewer' } -> { role: 'admin' }`). `actor_id` has
   no foreign key, so entries outlive deleted users.
5. **Purge path for M8 (org deletion), designed now:** a `SECURITY DEFINER` procedure owned by
   `ig_owner`, `purge_organization(org_id)`, sets a transaction-local flag and deletes the
   org's rows. The trigger will allow DELETE only when `current_user = 'ig_owner'` **and** the
   flag is set. The app role cannot become the owner, and the owner's ordinary sessions do not
   set the flag, so both conditions together identify the procedure. Until M8 the trigger
   has no exception, and `audit_log.org_id` references `organizations` with no cascade:
   deleting an org with audit history fails, which is the safe failure.

## Verification

`packages/db/src/audit-log.int.test.ts`: the app role gets 42501 for UPDATE/DELETE/TRUNCATE;
the owner role gets `IG001` for all three and the row is unchanged; writing into another org
fails; an entry rolls back with its failed transaction.

## Consequences

- An owner could still `ALTER TABLE audit_log DISABLE TRIGGER`. The owner role exists only
  for migrations and is never deployed with the app (ADR-0015).
- The audit log page (FR-ADM-1: filter, export) is a later milestone. `AUDIT_ACTIONS` in
  `packages/shared/src/audit.ts` is the vocabulary it will filter on.
