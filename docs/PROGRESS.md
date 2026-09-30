# Progress

Updated at the end of every milestone (CLAUDE.md workflow).

## Status

| Milestone                    | Status                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| M0 Foundations               | **Done** (2026-09-30). Merged to `main`; CI green on all jobs |
| M1 Auth, orgs, RBAC, tenancy | Not started (waiting for go-ahead)                                                     |
| M2 to M9                     | Not started                                                                            |

---

## M0: Foundations

### Task list

- [x] Bootstrap git (`main` + initial docs commit, work on `m0-foundations`)
- [x] pnpm workspace, TypeScript strict, ESLint (with architecture boundary rules), Prettier
- [x] `packages/shared`: env validation, typed errors + error shape, logger with redaction, queue names
- [x] Docker Compose: Postgres 16, Redis 8, RustFS (S3), Mailpit, with healthchecks
- [x] Native services without Docker (embedded Postgres, Memurai/Redis, fs storage)
- [x] `packages/db`: connection wrapper, migration runner, baseline migration, role bootstrap
- [x] `packages/storage`: S3 + fs drivers, key validation, ensure-bucket CLI
- [x] `apps/web`: Next.js + Tailwind landing page, `/api/health` (readiness), `/api/health/live`
- [x] `apps/worker`: BullMQ worker, validated job payloads, graceful shutdown
- [x] Tests: unit (Vitest), integration (Docker or native), e2e smoke (Playwright)
- [x] CI workflow (ubuntu with Docker, Windows native, e2e with compose)
- [x] ADRs 0001-0006 from ARCHITECTURE.md section 15, plus 0008-0014 for M0 decisions
- [x] Acceptance verification (below), PROGRESS and CLAUDE.md updated

### Acceptance criteria and how each was verified

SPEC.md M0: _`docker compose up` plus `pnpm dev` serves a page and a `/api/health` that checks
the DB, Redis, and storage. CI passes on a clean clone._

| Criterion                                     | Verified how                                                                                                                                                                                                                       | Result                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Monorepo, TS strict, ESLint, Prettier, Vitest | `pnpm check`                                                                                                                                                                                                                       | Green: lint 0 problems, Prettier clean, typecheck 11 packages + root, 101 unit tests |
| Architecture rules actually enforced          | `tools/eslint/boundaries.test.ts` lints fixtures (core imports `pg`/`node:fs`/`db`, `Date.now()`, `Math.random()`, `process`, raw `pg` in apps, default exports, relative cross-package imports)                                   | All rejected; legitimate imports accepted                                            |
| Migrations tooling                            | Integration test on a fresh database: first run applies, second run is a no-op. `pnpm dev:native` log on restart: `appliedBefore:1, appliedAfter:1`                                                                                | Pass                                                                                 |
| App role cannot bypass RLS                    | Integration test: `ig_app` not superuser, `rolbypassrls=false`, not member of `ig_owner`, `CREATE TABLE`/`CREATE SCHEMA` rejected with 42501, DML on later tables via default privileges                                           | Pass                                                                                 |
| Environment validation                        | Unit tests (conditional S3 vars, fs forbidden in production, values never echoed). Boot check: `next start` with fs storage fails with `STORAGE_DRIVER: the fs driver is for local development only`                               | Pass                                                                                 |
| Services up + `pnpm dev` serves a page        | Native mode on this PC: `pnpm dev:native`, then `curl /` = 200 with `<h1>InvoiceGuard</h1>`                                                                                                                                        | Pass                                                                                 |
| `/api/health` checks DB, Redis, storage       | `curl /api/health` = 200 `{"status":"ok","checks":{"database":ok,"redis":ok,"storage":ok}}`. Killed the Redis process = **503** with only `redis: fail` and liveness still 200. Restarted Redis = 200 again without restarting web | Pass                                                                                 |
| Health integration tests                      | `route.int.test.ts`: all ok = 200; Redis unreachable = 503 naming redis; wrong DB password = 503 naming database (password not echoed); invalid config = generic 500                                                               | Pass                                                                                 |
| Worker processes jobs                         | `workers.int.test.ts` against real Redis: ping round trip, deterministic-ID dedupe, invalid payload fails with no retries                                                                                                          | Pass                                                                                 |
| E2E                                           | `pnpm test:e2e` (Playwright chromium): landing page, readiness 200 with 3 checks, liveness                                                                                                                                         | 3/3 pass                                                                             |
| Production build                              | `pnpm build`                                                                                                                                                                                                                       | Pass                                                                                 |
| `docker compose up` path | CI job `e2e` (ubuntu): compose up, bucket, migrate, build, `next start`, Playwright with the S3 driver. Job `check` runs Testcontainers incl. the RustFS S3 tests | Pass ([run 36686067521](https://github.com/Shaownak/InvoiceGuard/actions/runs/36686067521)) |
| CI passes on a clean clone | GitHub Actions on https://github.com/Shaownak/InvoiceGuard: `check` (ubuntu, Docker), `check-native` (Windows, no Docker), `e2e` (ubuntu) | Pass, all 3 jobs (run 36686067521) |

### Deviations (all recorded as ADRs)

- **ADR-0011**: runs with or without Docker (office PC cannot run Docker). Native Postgres,
  Redis and fs storage; test infra auto-selects Docker or native.
- **ADR-0012**: RustFS replaces MinIO (MinIO no longer publishes images).
- **ADR-0013**: job IDs use `.` (`extract.{id}`), because BullMQ rejects `:`. Found by an integration test.
- **ADR-0008**: health endpoints are `/api/health` + `/api/health/live`, unversioned (resolves C1).
- **ADR-0009**: per-process conditional env validation (resolves C3).
- **ADR-0010**: TypeScript pinned to 6.0.x (typescript-eslint does not support TS 7 yet); no Turborepo.
- **ADR-0014**: UUID v7 via a database function (resolves C4).
- ARCHITECTURE.md sections 1, 2, 3, 6, 9 and 14 updated to point at these ADRs. SPEC.md unchanged.

### Known issues

| #   | Issue                                                                                                                                                                                      | Plan                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| K1  | ~~CI never run~~ Resolved: first runs found two native-mode bugs on Windows (below), both fixed; all jobs green | Done |
| K2  | S3 integration tests (5) are skipped in native mode                                                                                                                                        | Covered by CI `check` (Docker). Intended (ADR-0011)                                                        |
| K3  | `pnpm start` (production mode) cannot run locally without S3, because the fs driver is refused in production                                                                               | By design (ADR-0009). Local e2e uses the dev server                                                        |
| K4  | Next.js anonymous telemetry is on by default in dev                                                                                                                                        | Your call: set `NEXT_TELEMETRY_DISABLED=1` in `.env` / CI if you prefer. Not changed silently              |
| K5  | Worker runs via `tsx` (no production bundle) and has no HTTP health endpoint                                                                                                               | M9 (bundle, Dockerfile.worker); M8 (queue admin page)                                                      |
| K6  | Local Postgres minor version differs: embedded 16.14 vs Docker/CI 16.15                                                                                                                    | Harmless; bump when embedded-postgres ships 16.15                                                          |
| K7  | On this machine, pnpm's shim does not work from Git Bash; use PowerShell or `cmd` for pnpm                                                                                                 | Environment only                                                                                           |
| K8  | `next dev` 16.3 writes AGENTS.md/CLAUDE.md into apps/web by default                                                                                                                        | Disabled with `agentRules: false` in `next.config.ts`                                                      |
| K9  | Windows `MAX_PATH` (260): embedded Postgres fails with `spawn ...initdb.exe ENOENT` when the repo path is deep (found while verifying commits in a temp worktree at a 100+ character path) | Clone to a path under ~90 characters (README note). Enabling Windows long paths also works but needs admin |

Fixed after the first CI runs:

- `check-native` failed with "Unknown Error": embedded-postgres rejected with no error value.
  Test-infra startup now labels each step, attaches Postgres output, and emits a public
  GitHub annotation on failure.
- Root cause: Postgres refuses to start under an administrator account (GitHub's Windows
  runners; also local-admin developers). On Windows the server is now started and stopped via
  `pg_ctl`, which drops admin rights.
- Open: `pnpm/action-setup@v4` triggers a GitHub deprecation warning (Node 20 actions).
  Harmless; bump when a newer major is confirmed.

No TODOs in code.

### Open spec issues (register)

Resolved in M0: C1 (ADR-0008), C3 (ADR-0009), C4 (ADR-0014). C2 is handled by process: the
ground-truth suite is added to `pnpm check` at M4, when the engine exists (the generator
determinism test lands in M2). It is not faked earlier.

| #   | Issue                                                                                                                                                          | Proposed resolution                                                                                                                    | Decide by          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| C5  | Status machine lacks `ready` (M3 acceptance), `info_requested` (FR-REV-3), re-match edges from clean/flagged (FR-REV-2), matching failure, historical terminal | `ready` = clean or flagged; add `info_requested`, re-match edges, `match_failed` with retry; historical invoices stop at clean/flagged | M3 (ADR)           |
| C6  | R19 can never fire: FR-EXT-8 stops low-confidence critical fields before matching; `minConfidence` duplicates the org threshold                                | R19 covers non-critical fields (tax ID, bank account, lines); threshold from org settings only                                         | M4                 |
| C7  | `memberships`/`invites` have `org_id` but are "not RLS", contradicting CLAUDE.md rule 3 and the enumeration test                                               | RLS on both; memberships policy `org_id = app.org_id OR user_id = app.user_id`                                                         | M1                 |
| C8  | Append-only `audit_log` vs GDPR full org deletion (FR-ADM-3); audit before/after may capture bank data                                                         | Purge only via an owner-role `SECURITY DEFINER` procedure the trigger recognizes; mask sensitive fields before audit writes            | M1 design, M8 test |
| C9  | `unit_price_minor bigint` cannot hold sub-cent unit prices; `qty x price` float risk                                                                           | Scaled-integer unit prices and quantities; basis points for percentages (ADR-0004 follow-up)                                           | Before M2 schema   |
| C10 | Absolute thresholds (R04, R13, R14, R15) are currency-dependent, but multi-currency is scheduled "before M7"                                                   | Decide at M4: scale by currency exponent; threshold rules skip non-base-currency invoices with an info note                            | Before M4          |
| C11 | `invoices.document_id` not nullable, but the CSV invoice register (Retro Audit) has no documents                                                               | Nullable plus `source` column; R18/R19 skip rows without a document                                                                    | M2                 |
| C12 | Do retro invoices consume monthly quota? Can trials run a Retro Audit (the sales demo)?                                                                        | Separate usage kind `retro_invoice`; capped demo retro for trials                                                                      | M7                 |
| C13 | R14 holidays need a country calendar, but core is pure                                                                                                         | Pass the calendar in as data; pick the source at M4                                                                                    | M4                 |
| C14 | Extraction cache scope: SPEC says "by SHA-256", ARCHITECTURE says within org                                                                                   | Within org only (cross-tenant reuse would reveal another tenant uploaded the file)                                                     | M3                 |

### What M1 needs

- Decide **ADR-0007** (own auth on argon2 + DB sessions vs Auth.js) and **C7/C8**.
- Tables: organizations, users, memberships, invites, sessions, audit_log (+ append-only
  trigger), each with RLS policies in the same migration; `withOrg()` in `packages/db`.
- RLS enumeration test + cross-tenant suite (M1 acceptance); permission matrix in
  `packages/shared/permissions.ts` with a test over the whole matrix.
- Email: Mailpit via Docker, plus a native option (Mailpit single binary or a file
  transport) so verification and invite emails work without Docker.
- New env vars: `SESSION_SECRET`, `SMTP_URL`, `EMAIL_FROM` (schema, tests, `.env.example`).
- shadcn/ui setup with the first real screens (signup, login, verify, accept invite, org switch).
