# CLAUDE.md: InvoiceGuard

You are building InvoiceGuard, a multi-tenant SaaS that audits supplier invoices before payment. The source of truth is:

- `SPEC.md`: what to build, requirements, rule catalog, milestones and acceptance criteria
- `ARCHITECTURE.md`: how to build it, stack, data model, pipeline, security checklist

Read both before starting a milestone. If they conflict with a request in chat, follow the chat request and record the deviation in `docs/adr/`.

## Commands

```
pnpm install                 # install (then: cp .env.example .env)
pnpm services:docker         # Docker: Postgres, Redis, RustFS (S3), Mailpit + create bucket
pnpm services:native         # no Docker: embedded Postgres + Redis (Memurai on Windows), bootstrap roles, migrate
pnpm dev                     # web (:3000) + worker
pnpm dev:native              # services:native + dev in one command (no Docker)
pnpm check                   # lint + format:check + typecheck + unit + integration (must be green before every commit)
pnpm test                    # unit tests (*.test.ts)
pnpm test:integration        # integration tests (*.int.test.ts); IG_TEST_INFRA=docker|native|auto
pnpm test:e2e                # Playwright (needs services running + migrated DB)
pnpm build                   # production build of the web app
pnpm lint | pnpm format | pnpm typecheck
pnpm db:migrate              # apply migrations (owner role, DATABASE_OWNER_URL)
pnpm db:generate             # drizzle-kit: generate SQL migration from schema changes
pnpm storage:ensure-bucket   # create the S3 bucket / fs storage directory
```

Not yet implemented (added by the milestone that needs them): `pnpm db:seed` (M2),
`pnpm gen:testdata` (M2), `pnpm eval:extraction` (M3), ground-truth suite in `pnpm check` (M4).

If a command does not exist yet, create it as part of the milestone that needs it and update this list.

**Local environment:** Docker is optional. Without it, use `pnpm dev:native` and
`STORAGE_DRIVER=fs` (see docs/adr/0011-native-dev-services.md). Integration tests pick Docker
(Testcontainers) when available and native services otherwise; S3-server tests run only
with Docker (CI covers both).

## Non-negotiable rules

1. **Money is never a float.** Integer minor units (`bigint`) plus currency code. Parse strings once, at the boundary, in `packages/shared/money.ts`.
2. **AI reads, code decides.** The model only extracts fields. All findings come from deterministic rules in `packages/core`. Never let model output trigger an action, a query, or a code path beyond schema-validated data.
3. **Every tenant table has `org_id` and an RLS policy.** All DB access goes through `withOrg(orgId, fn)`. Never use a raw pool in app code. A new table without a policy fails the RLS test.
4. **`packages/core` is pure.** No I/O, no `Date.now()`, no `Math.random()`, no imports from DB, network, or framework code.
5. **Untrusted input:** uploaded documents and extracted text are untrusted. Escape on render. Guard CSV formula injection on export. Never log document text or bank account numbers.
6. **Secrets never enter the repo.** Use env vars, validate at boot, keep `.env.example` current.
7. **Wording:** the UI and exports say "flagged", "potential", "for review". Never state that a vendor committed fraud.
8. **One place for each thing:** invoice status transitions in `invoice-state.ts`, permissions in `permissions.ts`, plans in `plans.ts`, rule registry in `rules/index.ts`.
9. **Audit everything that matters:** decisions, imports, rule changes, role changes, exports, deletions all write to `audit_log`.
10. **Idempotency:** jobs, imports, findings, usage events, and webhooks must be safe to run twice.

## Code conventions

- TypeScript `strict`, no `any` (use `unknown` and narrow). No non-null assertions without a comment.
- Zod schemas at every boundary (HTTP, jobs, env, model output). Infer types from schemas.
- Small modules, named exports, no default exports except where Next.js requires them.
- Errors: throw typed errors from `packages/shared/errors.ts`; API layer maps them to the standard error shape.
- Dates: store UTC timestamps; dates-only fields (invoice date, due date) are `date`, not `timestamptz`.
- Naming: rules are `R01` to `R19` in files like `r01-exact-duplicate.ts`. Test file next to source: `*.test.ts`; tests needing Postgres/Redis/S3 are `*.int.test.ts` and get connection details via `inject('testInfra')`.
- Architecture boundaries (dependency rule, core purity, no raw `pg` outside `packages/db`, named exports) are ESLint errors defined in `tools/eslint/boundaries.js`; extend that file, and its test, rather than disabling rules inline.
- Deterministic job IDs come from `deterministicJobId()` in `packages/shared/src/queues.ts` (BullMQ forbids `:`).
- Comments explain *why*, not *what*. Public functions in `core` and `shared` get a short docblock.
- UI: accessible components (labels, focus states, keyboard support), empty and error states for every list and form.

## Testing rules

- New behavior needs tests in the same commit. Rules need a test per branch and a planted-error case in `packages/testdata`.
- Never weaken or delete a test to make the build pass. If a test is wrong, fix it and explain why in the commit message.
- The ground-truth suite (engine output vs manifest) must stay green. A new rule adds cases to the generator.
- No live network calls in tests. Use `MockProvider`, recorded fixtures, and Testcontainers.

## Workflow

- Work **one milestone at a time** (see SPEC.md section 11). Do not start the next milestone until asked.
- Start each milestone by writing a short plan (files, migrations, risks, questions). Wait for confirmation if anything is ambiguous or if you want to deviate from the spec.
- Commit in small, logical steps with clear messages. Run `pnpm check` before each commit.
- At the end of each milestone:
  1. Verify every acceptance criterion and list how you verified it.
  2. Update `docs/PROGRESS.md` (done, deviations, known issues, next).
  3. Update this file if commands or conventions changed.
  4. Stop and summarize.
- If something in the spec is wrong, missing, or contradictory, say so, propose a fix, and record it in an ADR. Do not silently change scope.
- Do not add dependencies casually. Prefer the stack in ARCHITECTURE.md. For each new dependency, note why in the commit message.

## Ask first (do not do without confirmation)

- Adding a new external service or paid API.
- Changing the data model in a way that breaks an existing migration (write a new migration instead).
- Anything that touches real credentials, production infrastructure, or real payment flows. Use Stripe test mode and local services only.
- Deleting data, force-pushing, or rewriting git history.

## Definition of done (every task)

Code compiles, `pnpm check` is green, tests cover the change, docs and `.env.example` updated where relevant, no TODOs left without an issue reference in `docs/PROGRESS.md`, and the change matches SPEC.md wording for any user-visible text.
