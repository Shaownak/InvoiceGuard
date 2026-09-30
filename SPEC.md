# InvoiceGuard: Product Specification

Working name: **InvoiceGuard** (rename freely). Version 1.0.

## 1. Summary

InvoiceGuard is a multi-tenant web application that audits supplier invoices *before* a company pays them. Users upload invoices (PDF or image). The system extracts the data with a vision-capable AI model, matches each invoice to purchase orders (POs) and goods receipts, runs a catalog of deterministic detection rules, and presents a prioritized review queue of findings. It also offers a **Retro Audit** mode that scans historical invoices to find money already lost to duplicate payments and billing errors. That mode doubles as the sales demo.

**Design principle:** AI is used only for *reading* documents. Every finding comes from deterministic, testable rules. Nothing the model outputs can trigger an action on its own.

## 2. Problem and value

- Mid-size companies (roughly 500 to 20,000 invoices per month) lose an estimated 1 to 3% of spend to duplicate payments, overbilling, price creep, and fraud.
- They cannot afford enterprise AP suites and check invoices by eye or in spreadsheets.
- Value proposition: catch errors before payment, and show the money already lost in the last 3 to 12 months.

## 3. Customers and personas

| Persona | Role in app | Needs |
|---|---|---|
| AP Clerk | `reviewer` | Fast queue, clear reasons for each flag, side-by-side document view |
| AP Manager | `approver` / `admin` | Decide on flagged invoices, tune rules, see savings |
| CFO / Internal Auditor | `viewer` | Reports, audit trail, exports |
| Accounting firm partner | multi-org member | Run audits for several client companies from one login |

## 4. Goals and non-goals

**MVP goals**
- Upload, extract, match, flag, review, decide, report.
- Retro Audit on a batch of historical invoices.
- Self-serve signup, subscription billing, usage metering.
- Complete audit trail and strict tenant isolation.

**Non-goals for v1**
- Paying invoices or any bank integration.
- Write-back to ERPs (import via CSV only; connectors are v1.1).
- GL coding, approval routing by cost center, or full AP workflow.
- Email-inbox ingestion (v1.1).
- Native mobile apps, and a non-English UI (the app must still *extract* multilingual documents).

## 5. Glossary

- **Invoice**: a bill from a vendor. **PO**: purchase order. **GRN**: goods receipt note.
- **Three-way match**: invoice vs PO vs GRN. **Two-way match**: invoice vs PO.
- **Finding**: one rule violation on one invoice, with evidence.
- **Tolerance**: allowed variance (percentage or absolute) before a rule fires.
- **Minor units**: money stored as integer minor units (cents), never floats.

## 6. Functional requirements

### 6.1 Accounts and organizations
- FR-AUTH-1: Email plus password signup and login, and magic-link login. Passwords hashed with argon2id. Email verification required.
- FR-AUTH-2: Password reset by email. Session cookies are httpOnly, secure, and sameSite=lax.
- FR-ORG-1: A user can belong to multiple organizations and switch between them.
- FR-ORG-2: Roles per organization: `owner`, `admin`, `approver`, `reviewer`, `viewer`. See the permission matrix in ARCHITECTURE.md.
- FR-ORG-3: Invite users by email with a role. Invites expire after 7 days.
- FR-ORG-4: Organization settings: default currency, base country, approval threshold, rule tolerances, low-confidence threshold, data retention period.

### 6.2 Master data import
- FR-DATA-1: CSV import for vendors, POs (with lines), and goods receipts (with lines). Column mapping UI with a saved mapping per organization.
- FR-DATA-2: Import validates rows, reports errors per row, and is transactional per file. Re-importing the same file is idempotent (upsert by external reference).
- FR-DATA-3: Vendors can hold multiple bank accounts. Bank accounts are stored encrypted, with an HMAC hash for comparison and the last 4 characters for display.
- FR-DATA-4: Import history page with counts of created, updated, and rejected rows.
- FR-DATA-5: Sample CSV templates are downloadable.

### 6.3 Ingestion
- FR-ING-1: Drag-and-drop upload of PDF, PNG, JPG, and TIFF. Batch upload up to 200 files. Max 20 MB and 30 pages per file.
- FR-ING-2: Files are stored in object storage under an org-scoped key. SHA-256 is computed, and an identical file already uploaded by the org is flagged as an exact re-upload (see R01).
- FR-ING-3: Each file creates a `document` and an `invoice` in status `uploaded`, then enqueues extraction.
- FR-ING-4: A multi-invoice PDF (several invoices in one file) is out of scope for v1. Detect and flag as `needs_verification`.

### 6.4 Extraction
- FR-EXT-1: Extract header fields: vendor name, vendor tax ID, invoice number, invoice date, due date, currency, subtotal, tax total, total, PO reference, payment terms, bank account (IBAN or account number), remit-to name.
- FR-EXT-2: Extract line items: description, SKU or item code, quantity, unit of measure, unit price, tax rate, line total.
- FR-EXT-3: Every field carries a confidence in [0,1] and a page number. Bounding box is optional (v1.1).
- FR-EXT-4: Model output is validated against a strict Zod schema. On validation failure, retry once with the validation errors fed back. After that, status becomes `extraction_failed`, visible in the UI with a retry button.
- FR-EXT-5: Results are cached by file SHA-256 so a re-upload never pays for extraction twice.
- FR-EXT-6: Token counts and USD cost are recorded per extraction.
- FR-EXT-7: Prompt-injection safety: document content is untrusted data (see ARCHITECTURE.md section 13).
- FR-EXT-8: Any critical field (invoice number, date, total, vendor) below the org's confidence threshold sets status `needs_verification`. A human confirms or corrects values before matching runs.

### 6.5 Matching
- FR-MATCH-1: **Vendor resolution:** tax ID exact match first, then normalized-name match, then trigram similarity above a threshold (suggested, needs human confirm). Unresolved vendors surface as "New vendor" and trigger R15.
- FR-MATCH-2: **PO resolution:** by PO reference on the invoice, normalized. If absent, propose candidates by vendor plus amount plus date proximity (suggested, never auto-applied below high confidence).
- FR-MATCH-3: **Line matching:** SKU exact, then description similarity, then position. Each invoice line links to at most one PO line.
- FR-MATCH-4: Matching is deterministic and re-runnable. Re-running never duplicates findings (see idempotency in ARCHITECTURE.md).

### 6.6 Detection rules

All rules live in `packages/core`, are pure functions, and have unit tests for every branch. Parameters are configurable per org with the defaults below.

| ID | Name | Logic | Default severity | Key parameters |
|---|---|---|---|---|
| R01 | Exact duplicate | Same vendor and same normalized invoice number, or identical file hash | Critical | none |
| R02 | Fuzzy duplicate | Same vendor, same total, dates within N days, and invoice number normalized-equal or edit distance ≤ 2 | High | `windowDays=30`, `maxEditDistance=2` |
| R03 | Cross-vendor duplicate | Same total and same bank account hash or tax ID under a different vendor record | High | `windowDays=60` |
| R04 | Arithmetic error | Line sums ≠ subtotal, or subtotal + tax ≠ total | Medium | `toleranceMinor=1` |
| R05 | Unit price vs PO | Invoiced unit price differs from PO line beyond tolerance | Medium; High if above `highPct` | `tolerancePct=2`, `highPct=10` |
| R06 | Quantity vs PO | Invoiced quantity > ordered quantity | High | `tolerancePct=0` |
| R07 | Quantity vs receipt | Cumulative invoiced quantity > cumulative received quantity (three-way) | High | `tolerancePct=0` |
| R08 | Missing PO | No PO reference or match where org policy requires one | Medium | `requirePo=true` |
| R09 | PO overbilling | Cumulative invoiced against PO > PO total | High | `tolerancePct=1` |
| R10 | Price drift | Unit price up more than X% vs vendor's trailing median for the same item | Medium | `lookbackMonths=6`, `driftPct=8` |
| R11 | Tax anomaly | Tax rate differs from PO line or vendor history | Medium | `tolerancePct=0.5` |
| R12 | Bank detail change | Invoice bank account differs from the vendor's known accounts | Critical | none |
| R13 | Split invoices | Multiple invoices from a vendor within N days whose sum crosses the approval threshold while each stays below | Medium | `windowDays=14` |
| R14 | Statistical oddities | Exact round-number totals, weekend or holiday invoice dates | Low | `roundModulusMinor=100000` |
| R15 | New vendor, high value | First invoice from a vendor above threshold | Medium | `thresholdMinor` |
| R16 | Date anomalies | Invoice date in the future, before PO date, or GRN after invoice | Low/Medium | none |
| R17 | Currency mismatch | Invoice currency differs from PO currency | High | none |
| R18 | Document integrity | PDF metadata suggests editing after creation, or producer differs from that vendor's previous invoices (advisory only) | Medium | none |
| R19 | Needs verification | Low-confidence critical fields (routes to manual check, not an accusation) | Info | `minConfidence=0.85` |

Each finding stores: rule ID, severity, human-readable title, structured `detail`, `evidence` (references to related invoices, PO lines, and document pages), and `amount_at_risk_minor` where computable.

**Risk score:** 0 to 100 per invoice, computed from finding severities with diminishing returns. The formula lives in `packages/core/src/risk.ts`, is documented, and is tested.

### 6.7 Review workflow
- FR-REV-1: Review queue with filters (status, severity, rule, vendor, date, amount), sorting, and saved views.
- FR-REV-2: Invoice detail page with side-by-side document viewer (PDF/image with zoom and page navigation) and extracted data. Findings listed with evidence links. Editing an extracted field re-runs matching.
- FR-REV-3: Decisions: **Approve**, **Reject**, **Hold**, **Request info** (adds a comment and a status). Rejecting or approving an invoice with open Critical findings requires a written reason.
- FR-REV-4: Per-finding actions: **Confirm** or **Dismiss** (dismissal requires a reason and feeds tuning stats).
- FR-REV-5: Comments per invoice, and an activity timeline built from the audit log.
- FR-REV-6: Keyboard shortcuts for queue navigation and decisions.
- FR-REV-7: Only `approver`, `admin`, and `owner` can make final decisions. `reviewer` can annotate and recommend.

### 6.8 Retro Audit
- FR-RETRO-1: Create an audit run with a name and an optional date range. Upload historical invoices in bulk, or run the rules over invoice records imported from CSV (invoice register with vendor, number, date, amount, PO).
- FR-RETRO-2: Progress view with counts of processed, failed, and flagged.
- FR-RETRO-3: Results summary: total flagged amount, duplicate payments found, overbilling, top vendors by exposure, and findings by rule.
- FR-RETRO-4: **PDF executive summary export** with charts, suitable to send to a CFO. Amounts are labeled "potential recovery, subject to review".
- FR-RETRO-5: Retro invoices are marked `historical` and never enter the live approval queue.

### 6.9 Reporting
- FR-RPT-1: Dashboard: invoices processed, open findings, amount at risk, confirmed savings, average review time, top vendors by flags.
- FR-RPT-2: Rule effectiveness: fired, confirmed, dismissed, and precision per rule.
- FR-RPT-3: Exports: CSV and XLSX for invoices, findings, and the audit log, respecting the current filters.

### 6.10 Billing and usage
- FR-BILL-1: Stripe Checkout and Customer Portal. Plans are configuration, not code (see section 9).
- FR-BILL-2: A usage event is recorded per successfully extracted invoice. Failed extractions are not billed.
- FR-BILL-3: Enforce plan limits: soft warning at 80%, hard block on new uploads at 100% plus a configurable grace amount, with an upgrade prompt.
- FR-BILL-4: Stripe webhooks are verified, idempotent, and update subscription state.
- FR-BILL-5: 14-day trial with 50 free invoices, no card required.

### 6.11 Administration and compliance
- FR-ADM-1: Audit log page (filterable, exportable). The log is append-only, enforced by a database trigger.
- FR-ADM-2: Data retention: organization-configurable deletion of documents after N days. Deletion removes files and extracted text but keeps decision records.
- FR-ADM-3: Organization data export and full deletion on request (GDPR-style).
- FR-ADM-4: Rule configuration UI: enable or disable, edit parameters, override severity. Every change is audited.

## 7. Screens

1. Marketing landing page and pricing.
2. Signup, login, verify email, accept invite.
3. Onboarding checklist: import vendors, import POs, upload first invoice, run Retro Audit.
4. Dashboard.
5. Review queue.
6. Invoice detail and review.
7. Upload and batch status.
8. Vendors list and vendor detail (bank accounts, history, risk).
9. POs list and PO detail (invoiced vs received vs ordered).
10. Import wizard and import history.
11. Retro Audit list, run detail, and report.
12. Reports and exports.
13. Settings: organization, members, rules, billing, data retention.
14. Audit log.

**UX requirements:** responsive layout down to tablet, dark mode, WCAG AA contrast, empty states with guidance, optimistic UI on decisions, and every long operation shows progress.

## 8. Extraction specification

- **Input:** for each page, the PDF text layer (when present) and a rendered image (about 150 to 200 DPI, max long edge about 2000 px). The provider interface accepts either the native PDF document block or page images.
- **Output:** JSON conforming to `InvoiceExtractionSchema` in `packages/shared`. Money is returned as strings in the document's own decimal format plus a currency code, then parsed by deterministic code into minor units. The model never does arithmetic that the code depends on.
- **Confidence:** the model reports per-field confidence. The pipeline also computes derived confidence (for example, lower if line sums do not match the total).
- **Prompt versioning:** prompts live in `packages/extraction/prompts/` with a version string stored on each extraction.
- **Model:** configurable through `EXTRACTION_MODEL`. Provide a `MockProvider` that replays fixtures so development, CI, and demos run without API calls.
- **Evaluation harness:** `pnpm eval:extraction` runs the provider over the synthetic corpus and reports per-field accuracy against ground truth. Target: at least 97% exact-match on header fields and 95% on line items for clean synthetic documents.

## 9. Plans (configuration, adjustable)

| Plan | Price | Included invoices / month | Overage |
|---|---|---|---|
| Trial | Free, 14 days | 50 total | blocked |
| Starter | $99 | 500 | $0.25 each |
| Growth | $399 | 3,000 | $0.15 each |
| Scale | Custom | Custom | Custom |
| Retro Audit (one-time) | $499 flat per run up to 2,000 invoices | n/a | n/a |

Store plans in a config file plus Stripe price IDs in environment variables. Track `ai_cost_usd` per invoice so gross margin per customer is visible in an internal admin view.

## 10. Success metrics

- Deterministic rules: 100% of planted errors in the synthetic corpus detected (recall) with zero unexplained false positives on the clean control set.
- Extraction accuracy targets in section 8.
- Median time from upload to "ready for review" under 60 seconds for a 3-page invoice.
- Review time per flagged invoice tracked; target under 2 minutes median.
- Product: percentage of pilot customers who find at least one confirmed recoverable amount in their Retro Audit.

## 11. Milestones and acceptance criteria

Each milestone ends with: `pnpm check` green (lint, typecheck, unit, integration), docs updated, `docs/PROGRESS.md` updated, and a commit.

**M0: Foundations.** Monorepo (pnpm workspaces), TypeScript strict, ESLint, Prettier, Vitest, Docker Compose (Postgres, Redis, MinIO, Mailpit), migrations tooling, environment validation, health endpoints, CI workflow, `CLAUDE.md` in place.
*Accept:* `docker compose up` plus `pnpm dev` serves a page and a `/api/health` that checks the DB, Redis, and storage. CI passes on a clean clone.

**M1: Auth, orgs, RBAC, tenancy.** Signup, login, verification, invites, org switching, roles, Postgres row-level security, audit log with append-only trigger.
*Accept:* A cross-tenant access test suite proves that a user in org A can never read or write org B data at the DB level, even when app code forgets an `org_id` filter. All role permissions are tested against the matrix.

**M2: Master data and synthetic data.** CSV import for vendors, POs, GRNs with mapping UI, bank account encryption, vendors and POs pages. Synthetic data generator that produces vendors, POs, GRNs, and invoice PDFs and images (clean, messy scans, multiple layouts) with a **ground-truth manifest** listing every planted error.
*Accept:* Importing the generated CSVs succeeds and is idempotent. The generator is deterministic given a seed and produces at least 300 invoices covering every rule R01 to R18.

**M3: Ingestion and extraction.** Upload UI, storage, job queue, extraction provider (Anthropic plus Mock), schema validation, retry, caching by hash, cost tracking, needs-verification flow, extraction eval harness.
*Accept:* Uploading the synthetic corpus with the MockProvider reaches `ready` for all invoices. Eval harness runs end to end. Failure and retry paths are tested. Live-API run is documented and works when a key is present.

**M4: Matching and rules engine.** Vendor, PO, and line matching plus rules R01 to R19, risk score, idempotent re-runs, org-level rule configuration.
*Accept:* Against the ground-truth manifest, every planted error is found by the intended rule, and no rule fires on the clean control set. Coverage for `packages/core` at least 95% lines. Property-based tests for normalization and money math.

**M5: Review UI and workflow.** Queue, invoice detail with document viewer, findings actions, decisions with reasons, comments, timeline, keyboard shortcuts.
*Accept:* Playwright e2e covers upload, extraction, flagged review, dismiss, approve with reason, and audit trail entries. Permission checks tested for each role.

**M6: Retro Audit and reports.** Audit runs, bulk processing with progress, results summary, PDF executive summary, dashboard, exports.
*Accept:* A Retro Audit on the synthetic corpus produces a summary whose totals match the manifest. The PDF export renders correctly and passes a snapshot test of its data.

**M7: Billing and usage.** Stripe plans, checkout, portal, webhooks, usage metering, limits, trial.
*Accept:* Stripe test-mode flow works (documented). Webhook handler is idempotent (tested with replayed events). Limits block and warn as specified.

**M8: Hardening.** Security review pass, rate limiting, file validation and optional malware scan hook, structured logging, tracing hooks, error tracking, load test at 10k invoices, backup and restore notes, accessibility pass.
*Accept:* Security checklist in ARCHITECTURE.md section 13 fully ticked. Load test result recorded in `docs/PERFORMANCE.md`.

**M9: Launch readiness.** Landing page, pricing page, help docs, demo dataset one-click, production deployment guide and IaC or platform config, privacy policy and terms placeholders clearly marked for legal review, runbook.
*Accept:* Fresh deployment from docs works. Demo dataset loads and shows findings within 2 minutes.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Extraction errors cause wrong findings | Confidence thresholds, needs-verification gate, human review, eval harness, arithmetic cross-checks |
| False positives erode trust | Per-rule precision tracking, tolerances, dismissal reasons, tune before launch with pilot data |
| Sensitive financial data | Encryption at rest and in transit, RLS, retention controls, no training on customer data, clear DPA |
| Prompt injection via documents | Untrusted-data handling, schema-only output, no side-effect tools, output validation |
| Vendor lock-in to one model | Provider interface, mock provider, prompt versioning |
| Cost overruns from AI usage | Hash cache, cost tracking per invoice, plan limits, page caps |
| Fraud claims made about vendors | Language is "potential", "flagged for review"; never assert fraud in UI or exports |

## 13. Assumptions and open questions

- Assumes CSV import is acceptable for POs and GRNs at launch. ERP connectors come after the first paying customers.
- Assumes English-first UI. Extraction should handle other languages as the model allows, but rule descriptions are English.
- Decide before M7: default currency handling for multi-currency customers (v1 flags mismatches only and does not convert).
- Decide before M9: hosting target and region, based on the first customers' data residency needs.
