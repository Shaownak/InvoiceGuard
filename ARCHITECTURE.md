# InvoiceGuard: Architecture

## 1. System context

```
                    +-----------------------------+
   Browser  <-----> |  apps/web (Next.js)         |
                    |  UI + REST API + webhooks   |
                    +---+-----------+---------+---+
                        |           |         |
                 Postgres 16     Redis      S3-compatible
                 (RLS, pgvector  (BullMQ    object storage
                  not needed)    queues)    (RustFS locally)
                        ^           ^
                        |           |
                    +---+-----------+---+        +------------------+
                    |  apps/worker      | -----> | Anthropic API    |
                    |  jobs: extract,   |        | (via provider    |
                    |  match, report    |        |  interface)      |
                    +-------------------+        +------------------+
                        Stripe (billing)   SMTP (email)
```

Two deployable processes share one codebase and one database: the **web app** and the **worker**. All business logic lives in framework-free packages so it can be tested without a server.

## 2. Tech stack and rationale

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language, strong types, Zod at boundaries |
| Web | Next.js (App Router), React | Single deployable for UI and API, large ecosystem |
| UI | Tailwind CSS, shadcn/ui, TanStack Table, TanStack Query | Fast to build, accessible primitives |
| DB | PostgreSQL 16 | Row-level security, trigram search (`pg_trgm`), strong consistency |
| ORM / migrations | Drizzle ORM plus SQL migrations | Typed queries, transparent SQL, easy RLS in raw SQL migrations |
| Queue | BullMQ on Redis | Retries, backoff, rate limits, concurrency control, dashboards |
| Storage | S3 API (RustFS in Docker dev, filesystem driver without Docker, S3 or R2 in prod; ADR-0011, ADR-0012) | Portable, signed URLs |
| Auth | Own implementation on `argon2` plus DB sessions (or Auth.js if simpler), decision recorded in an ADR | Full control of tenancy and roles |
| AI | `@anthropic-ai/sdk` behind an `ExtractionProvider` interface | Swappable, mockable |
| Validation | Zod, `zod-to-json-schema` for tool schemas | One source of truth for shapes |
| Money | `decimal.js` for parsing only, `bigint` minor units in storage and logic | No float errors |
| PDF rendering | `pdfjs-dist` (viewer), `pdf-lib` and Playwright/Chromium or `@react-pdf/renderer` for report generation | Viewer and generator needs differ |
| Billing | Stripe | Standard |
| Email | Nodemailer (Mailpit in dev) with a provider adapter | Simple |
| Tests | Vitest, fast-check, Testcontainers, Playwright | Unit, property, integration, e2e |
| CI | GitHub Actions | Standard |
| Local infra | Docker Compose, or native services without Docker (ADR-0011) | One command startup |
| Logging | pino (JSON), OpenTelemetry hooks | Structured, vendor-neutral |

**Model selection:** the extraction model is set by env var `EXTRACTION_MODEL`. Check the current model IDs at docs.claude.com when configuring, and pick the cheapest model that passes the eval harness thresholds. Keep prompts and schemas independent of the model.

## 3. Repository layout

```
invoiceguard/
  CLAUDE.md
  SPEC.md
  ARCHITECTURE.md
  docs/
    PROGRESS.md            # updated at the end of every milestone
    adr/                   # architecture decision records
    PERFORMANCE.md
    RUNBOOK.md
  apps/
    web/                   # Next.js app: UI, /api/v1, webhooks
    worker/                # BullMQ processors
  packages/
    core/                  # PURE: normalization, matching, rules, risk score. No I/O.
    shared/                # Zod schemas, types, money utils, constants, permissions
    db/                    # Drizzle schema, migrations, RLS SQL, repositories
    extraction/            # ExtractionProvider, Anthropic + Mock, prompts, eval harness
    storage/               # S3 client wrapper, signed URLs, key builders
    testdata/              # synthetic generator + ground-truth manifest
    billing/               # plans config, Stripe helpers, usage metering
    reports/               # PDF/XLSX/CSV builders
  tools/
    devinfra/              # native services (no Docker), test infra (Testcontainers or native)
    eslint/                # architecture boundary rules + their tests
  infra/
    docker-compose.yml
    postgres/              # role bootstrap SQL shared by Docker and native modes
    Dockerfile.web
    Dockerfile.worker
  .github/workflows/ci.yml
```

**Dependency rule:** `core` and `shared` depend on nothing internal (except `shared` from `core`). `db`, `extraction`, `storage`, `billing`, `reports` may depend on `shared` and `core`. `apps/*` may depend on anything. Enforce with ESLint import rules.

## 4. Data model

Conventions: UUID v7 primary keys, `org_id` on every tenant table, `created_at`/`updated_at` timestamps, money as `bigint` minor units plus `currency char(3)`, quantities as `numeric(18,4)`, enums as Postgres enums or checked text.

```
organizations(id, name, slug unique, plan, stripe_customer_id, settings jsonb, created_at)
users(id, email unique citext, name, email_verified_at, created_at, updated_at)
user_credentials(user_id pk, password_hash, updated_at)   -- apart from users: co-members may read users (ADR-0015)
memberships(id, org_id, user_id, role, created_at, updated_at, unique(org_id,user_id))
invites(id, org_id, email, role, token_hash, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at)
  -- at most one open invite per (org_id, email)
sessions(id, user_id, token_hash unique, active_org_id, user_agent, created_at, expires_at)
  -- (active_org_id, user_id) references memberships ON DELETE SET NULL (active_org_id)
auth_tokens(id, user_id, purpose verify_email|password_reset|magic_link, token_hash unique, expires_at, used_at, created_at)
  -- tokens are stored as HMAC-SHA256(SESSION_SECRET, token) (ADR-0007)

vendors(id, org_id, name, name_norm, tax_id, tax_id_norm, external_ref, status, created_at)
  -- unique(org_id, external_ref) where external_ref is not null; GIN trigram index on name_norm
vendor_bank_accounts(id, org_id, vendor_id, account_enc bytea, account_hash bytea, last4, first_seen_at, source)
  -- account_hash = HMAC(key, normalized account); index (org_id, account_hash)

purchase_orders(id, org_id, vendor_id, po_number, po_number_norm, currency, total_minor, issued_on, status, external_ref)
  -- unique(org_id, po_number_norm)
po_lines(id, org_id, po_id, line_no, sku, description, uom, qty, unit_price_minor, tax_rate)
goods_receipts(id, org_id, po_id, grn_number, received_on, external_ref)
grn_lines(id, org_id, grn_id, po_line_id, qty_received)

documents(id, org_id, storage_key, sha256, mime, size_bytes, pages, uploaded_by, source, pdf_meta jsonb, created_at)
  -- index (org_id, sha256)
invoices(id, org_id, document_id, vendor_id null, audit_run_id null, is_historical bool,
         status, invoice_number, invoice_number_norm, invoice_date, due_date, currency,
         subtotal_minor, tax_minor, total_minor, po_ref, po_ref_norm, matched_po_id null,
         bank_account_hash, risk_score, decision, decided_by, decided_at, decision_reason, created_at)
  -- indexes: (org_id, vendor_id, invoice_number_norm), (org_id, vendor_id, total_minor, invoice_date), (org_id, status)
invoice_lines(id, org_id, invoice_id, line_no, description, sku, uom, qty, unit_price_minor,
              line_total_minor, tax_rate, matched_po_line_id null)
extractions(id, org_id, document_id, provider, model, prompt_version, raw_output jsonb, parsed jsonb,
            field_confidence jsonb, input_tokens, output_tokens, cost_usd numeric(10,6), status, error, created_at)

findings(id, org_id, invoice_id, rule_id, severity, status, title, detail jsonb, evidence jsonb,
         amount_at_risk_minor null, fingerprint, created_at, resolved_by, resolved_at, resolution_note)
  -- unique(org_id, invoice_id, fingerprint)   <- idempotent re-runs
comments(id, org_id, invoice_id, user_id, body, created_at)
rule_configs(id, org_id, rule_id, enabled, params jsonb, severity_override, updated_by, updated_at)
audit_runs(id, org_id, name, status, date_from, date_to, totals jsonb, created_by, created_at)
import_jobs(id, org_id, kind, file_key, mapping jsonb, status, stats jsonb, errors jsonb, created_by)
usage_events(id, org_id, kind, quantity, invoice_id, occurred_at)
subscriptions(id, org_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, ...)
stripe_events(id text primary key, received_at)         -- webhook idempotency
audit_log(id, org_id, actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ip, user_agent, created_at)
  -- append-only: trigger raises on UPDATE/DELETE
```

**Invoice status machine**

```
uploaded -> extracting -> extraction_failed (retry -> extracting)
                       -> needs_verification (human confirms -> matching)
                       -> matching -> clean | flagged
clean | flagged -> approved | rejected | on_hold
on_hold -> approved | rejected
```

Status transitions are implemented in one module (`packages/db/src/invoice-state.ts`) with a transition table and tests. No other code writes `invoices.status`.

## 5. Multi-tenancy and row-level security

- Every tenant table has `org_id NOT NULL` and an RLS policy: `USING (org_id = current_setting('app.org_id')::uuid)` plus a matching `WITH CHECK`.
- The app connects as a non-superuser role that does **not** bypass RLS. Migrations run as a separate owner role.
- Every request and every job runs its DB work in a transaction that begins with `set_config('app.org_id', $1, true)` (transaction-local; ADR-0015). A helper `withOrg(orgId, fn)` is the only way to obtain a tenant-scoped DB handle. Lint rule and code review forbid raw pool access outside `packages/db`.
- Every other table has RLS too (ADR-0015): identity tables are scoped by `app.user_id`; `withUser(userId, fn)` sets it for a user's own rows outside an org, and six reviewed `SECURITY DEFINER` functions (exposed as `db.auth`) are the only pre-authentication paths. With no context the app role sees nothing.
- `audit_log` is append-only: the app role has only SELECT/INSERT and a trigger rejects UPDATE/DELETE/TRUNCATE for every role (ADR-0016).
- **Required tests:** for each table, create rows in org A, then attempt select, update, delete, and insert as org B and assert zero rows or an error. A test enumerates all tables with an `org_id` column and fails if any lacks a policy.

## 6. Processing pipeline

```
Upload (web)
  1. validate mime/size/pages, compute sha256
  2. put object to storage at orgs/{orgId}/documents/{documentId}
  3. insert document + invoice(status=uploaded), record usage intent, audit log
  4. enqueue  extract:{invoiceId}

Worker: extract
  1. if extraction cached for same sha256 within org -> reuse
  2. render pages / fetch PDF, call provider, validate with Zod (retry once with errors)
  3. parse money strings -> minor units; normalize invoice number, dates, tax IDs, bank account
  4. store extraction row (tokens, cost), fill invoice + lines
  5. if critical fields low confidence -> status=needs_verification; STOP
  6. else enqueue  match:{invoiceId}

Worker: match
  1. resolve vendor, PO, line links (packages/core matching)
  2. load context (history, PO/GRN state, org rule configs)
  3. run all enabled rules -> findings (upsert by fingerprint)
  4. compute risk score, set status clean|flagged
  5. record billable usage event (once, keyed by invoice id)
```

**Idempotency and retries**
- Job IDs are deterministic (`extract.{invoiceId}`, `match.{invoiceId}`, built by `deterministicJobId` in `packages/shared/src/queues.ts`), so double-enqueue is harmless. BullMQ forbids `:` in custom IDs (ADR-0013).
- Findings are upserted on `(org_id, invoice_id, fingerprint)`. The fingerprint is a hash of rule ID plus the stable inputs of the finding. Findings that no longer apply after a re-run are auto-closed with resolution `superseded`, unless a human already decided on them.
- Usage events have a unique constraint on `(org_id, kind, invoice_id)`.
- BullMQ: 3 attempts, exponential backoff, dead-letter queue viewable in an admin page. Provider calls have a concurrency limit and honor rate-limit responses with backoff.

## 7. Extraction service

```ts
interface ExtractionProvider {
  name: string;
  extract(input: {
    orgId: string;
    documentId: string;
    pages: { pageNumber: number; text?: string; imageBase64?: string; mime: string }[];
    pdfBytes?: Uint8Array;
    promptVersion: string;
  }): Promise<{
    raw: unknown;               // provider output, stored for audit
    parsed: InvoiceExtraction;  // validated against Zod schema
    usage: { inputTokens: number; outputTokens: number; costUsd: number };
    model: string;
  }>;
}
```

- **AnthropicProvider:** uses the tool-use pattern with a single `record_invoice` tool whose JSON schema is generated from the Zod schema, and `tool_choice` forcing that tool. Use prompt caching on the static system prompt. Model comes from `EXTRACTION_MODEL`.
- **MockProvider:** replays `packages/testdata` ground truth, with optional injected noise (drop a field, lower confidence) to test the verification path.
- **Cost accounting:** a `pricing.ts` table maps model to per-token prices, configurable by env, so `cost_usd` is computed locally.
- **Money handling:** the schema carries amounts as strings plus a `decimalSeparator` hint. `packages/shared/money.ts` parses them into minor units using the currency exponent table (JPY 0, KWD 3, default 2), and rejects ambiguous formats into `needs_verification`.

## 8. Rule engine design

```ts
// packages/core/src/rules/types.ts
export interface RuleContext {
  invoice: InvoiceFacts;           // normalized, minor units
  lines: InvoiceLineFacts[];
  vendor: VendorFacts | null;
  po: PoFacts | null;              // with lines
  receipts: ReceiptFacts[];        // cumulative to date
  history: {
    vendorInvoices: InvoiceFacts[];      // prior, non-rejected
    poInvoicedToDate: PoInvoicedFacts;
    itemPriceHistory: PricePoint[];
  };
  org: { approvalThresholdMinor: bigint; baseCurrency: string; policy: OrgPolicy };
  params: unknown;                 // validated per-rule params
  now: Date;                       // injected, never call Date.now() inside rules
}

export interface Rule<P> {
  id: `R${number}`;
  version: number;
  paramsSchema: ZodType<P>;
  defaultParams: P;
  defaultSeverity: Severity;
  run(ctx: RuleContext & { params: P }): Finding[];   // PURE
}
```

Rules:
- are pure and deterministic. No I/O, no clocks, no randomness.
- return findings with a `fingerprint` and structured `evidence`.
- are registered in one array in `packages/core/src/rules/index.ts`. Adding a rule means: file, tests, registry entry, doc row in SPEC.md section 6.6, and a planted-error case in the test data generator.

Normalization utilities (`packages/core/src/normalize.ts`) with property-based tests: invoice number normalization (case, whitespace, separators, leading zeros, `O`/`0` and `I`/`1` confusion handled only in the fuzzy comparator, never in the stored normal form), vendor name normalization (legal suffixes, punctuation, diacritics), PO reference normalization, IBAN and account normalization, edit-distance.

**Duplicate detection performance:** candidate lookup uses the composite indexes above, and the rule receives only candidates (same vendor, plus cross-vendor by bank hash or tax ID), so it stays O(candidates) rather than O(all invoices).

## 9. API surface (REST, `/api/v1`, JSON, Zod-validated)

```
POST   /auth/signup | /auth/login | /auth/logout | /auth/verify (+ /resend)
POST   /auth/magic-link (+ /consume) | /auth/password-reset (+ /confirm)        (ADR-0007)
GET    /me                               GET/POST /orgs            POST /orgs/:id/switch
GET    /members  |  PATCH/DELETE /members/:id
GET/POST /invites  |  DELETE /invites/:id  |  POST /invites/preview  |  POST /invites/accept

POST   /imports/:kind                    GET /imports  |  GET /imports/:id
GET    /vendors | /vendors/:id           GET /purchase-orders | /purchase-orders/:id

POST   /invoices/upload                  (multipart, batch)
GET    /invoices                         (filters, cursor pagination)
GET    /invoices/:id                     GET /invoices/:id/document (signed URL)
PATCH  /invoices/:id/fields              (human correction -> re-match)
POST   /invoices/:id/retry-extraction
POST   /invoices/:id/decision            {decision, reason}
POST   /invoices/:id/comments
POST   /findings/:id/confirm | /findings/:id/dismiss

GET/POST /audit-runs   GET /audit-runs/:id   GET /audit-runs/:id/report.pdf
GET    /reports/summary | /reports/rules
GET    /exports/:kind                    (csv|xlsx, streams)
GET/PUT /rules                           GET /audit-log

POST   /billing/checkout | /billing/portal    POST /webhooks/stripe
```

Health probes are unversioned (ADR-0008): `GET /api/health` is readiness (DB, Redis, storage; 200 or 503) and `GET /api/health/live` is liveness (no dependency checks).

Conventions: cursor pagination, consistent error shape `{error:{code,message,details}}`, idempotency-key header on uploads and decisions, rate limiting per user and per org.

## 10. Authorization

| Capability | owner | admin | approver | reviewer | viewer |
|---|---|---|---|---|---|
| View invoices, findings, reports | yes | yes | yes | yes | yes |
| Upload invoices, retry extraction | yes | yes | yes | yes | no |
| Edit extracted fields, comment | yes | yes | yes | yes | no |
| Confirm/dismiss findings | yes | yes | yes | recommend only | no |
| Final decision (approve/reject/hold) | yes | yes | yes | no | no |
| Import master data | yes | yes | no | no | no |
| Edit rules, org settings, retention | yes | yes | no | no | no |
| Manage members | yes | yes | no | no | no |
| Billing | yes | no | no | no | no |
| Delete organization | yes | no | no | no | no |

Permissions are defined once in `packages/shared/permissions.ts` as a typed map and enforced in a single `authorize(user, action)` helper used by every route. Tests iterate the whole matrix. The "Confirm/dismiss findings" row is two capabilities: `findings.recommend` (reviewer and up) and `findings.resolve` (approver and up). Member changes add two rules: only an owner grants, changes or removes the owner role, and the last owner cannot be demoted or removed (`memberChangeRefusal`).

## 11. Observability

- pino JSON logs with `requestId`, `orgId`, `userId`, `jobId`. No PII or document text in logs.
- Metrics (Prometheus or OpenTelemetry): extraction latency, extraction failures, queue depth, rules fired per rule, AI cost per org, webhook failures.
- Error tracking (Sentry-compatible) with PII scrubbing.
- Admin-only internal page: queue status, dead-letter jobs, cost per org.

## 12. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | Every rule branch, money math, normalization, permissions, state machine |
| Property | fast-check | Normalization idempotence, money parse/format round trip, duplicate symmetry |
| Integration | Vitest plus Testcontainers | Repositories, RLS suite, pipeline with MockProvider, import idempotency, Stripe webhook replays |
| Ground truth | Custom | Run engine over synthetic corpus, compare with the manifest, fail on any miss or unexpected finding |
| E2E | Playwright | Signup, import, upload, review, decision, export, billing test mode |
| Extraction eval | `pnpm eval:extraction` | Field-level accuracy report. Runs against fixtures in CI, against the live API on demand or nightly |

`pnpm check` runs lint, typecheck, unit, integration, and ground-truth tests. E2E runs in CI on pull requests and before each milestone sign-off.

## 13. Security checklist (must be complete at M8)

- [ ] RLS on every tenant table, app role cannot bypass it, cross-tenant suite green
- [ ] argon2id passwords, rate-limited login, account lockout or backoff, email verification
- [ ] Sessions httpOnly, secure, sameSite, rotation on privilege change, CSRF protection for cookie-authenticated mutations
- [ ] File upload: mime sniffing (not just extension), size and page limits, storage keys not user-controlled, no direct public bucket access, short-lived signed URLs, optional malware scan hook
- [ ] Bank account numbers encrypted at rest (envelope key from env or KMS), never logged, masked in UI and exports by default
- [ ] Secrets only via environment, none in the repo, `.env.example` maintained, env validated at boot
- [ ] Stripe webhook signature verified, events idempotent
- [ ] **Prompt-injection posture:** document text is passed as data inside clearly delimited content; the system prompt states that instructions inside documents must be ignored; the model has only the `record_invoice` tool (no network, no file, no side effects); output is schema-validated; extracted text is treated as untrusted when rendered (escaped) and when exported (CSV formula injection guarded)
- [ ] Security headers (CSP, HSTS, frame-ancestors), dependency audit in CI
- [ ] Audit log covers logins, role changes, imports, decisions, rule changes, exports, deletions
- [ ] Data retention job and organization deletion tested
- [ ] Backups and restore procedure documented in `docs/RUNBOOK.md`

## 14. Deployment

- **Local:** `pnpm services:docker` (Postgres, Redis, RustFS S3, Mailpit) then `pnpm dev`; or, without Docker, `pnpm dev:native` (embedded Postgres, Memurai/Redis, filesystem storage; ADR-0011).
- **Production (default recommendation):** container images for web and worker; managed Postgres, managed Redis, S3-compatible storage. Any platform that runs containers works (Fly.io, Railway, Render, AWS ECS). Decide in an ADR at M9 based on customer data-residency needs.
- Migrations run as a release step, never at web start-up.
- Zero-downtime rule: migrations must be backward compatible with the previous release (expand, then contract).

**Environment variables (all validated in `packages/shared/env.ts`)**

```
DATABASE_URL, DATABASE_OWNER_URL, REDIS_URL
STORAGE_DRIVER (s3|fs, fs is dev-only), STORAGE_FS_ROOT, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE
APP_URL, SESSION_SECRET, FIELD_ENCRYPTION_KEY, BANK_HASH_KEY
EMAIL_FROM, EMAIL_TRANSPORT (smtp|file, file is dev-only), SMTP_URL, EMAIL_FILE_DIR   (ADR-0017)
TRUST_PROXY_HEADERS (trust X-Forwarded-For for the audit-log client IP)
ANTHROPIC_API_KEY, EXTRACTION_PROVIDER (anthropic|mock), EXTRACTION_MODEL
MODEL_PRICE_INPUT_PER_MTOK, MODEL_PRICE_OUTPUT_PER_MTOK
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_RETRO
SENTRY_DSN (optional), LOG_LEVEL, WORKER_CONCURRENCY
DATABASE_ADMIN_URL (local bootstrap only, never deployed)
```

Each process validates only the variables it uses; conditional requirements are described in ADR-0009.

## 15. Decision log (initial ADRs to write in `docs/adr/`)

1. Monolith web plus worker, not microservices.
2. Postgres RLS for tenant isolation, with `withOrg` as the only DB entry point.
3. AI for reading only; deterministic rules for decisions.
4. Money as integer minor units; model outputs money as strings, parsed in code.
5. Provider interface with a mock for offline development, CI, and demos.
6. Findings are idempotent via fingerprint upserts.
7. Auth approach (own vs Auth.js), decided at M1 with reasons.
