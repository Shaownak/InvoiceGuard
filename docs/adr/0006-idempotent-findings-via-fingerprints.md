# ADR-0006: Findings are idempotent via fingerprint upserts

- Status: Accepted (implemented in M4)
- Date: 2026-09-30
- Source: ARCHITECTURE.md section 15, item 6

## Context

Matching and rules re-run often: after a human corrects an extracted field, after master data
imports, after rule configuration changes, and on job retries. Duplicate findings would inflate
"amount at risk", confuse reviewers, and break precision statistics.

## Decision

- Each finding carries a `fingerprint`: a hash of the rule ID plus the stable inputs that
  identify that specific violation (e.g. R01: rule + the IDs of both invoices).
- Findings are upserted on `unique(org_id, invoice_id, fingerprint)`.
- After a re-run, findings for that invoice whose fingerprint was not produced again are
  auto-closed with resolution `superseded`, unless a human already confirmed or dismissed them.
  Human decisions are never overwritten.
- The same principle applies elsewhere: deterministic job IDs (ADR-0013), usage events unique
  on `(org_id, kind, invoice_id)`, and Stripe events keyed by event ID.

## Consequences

- Re-running the engine any number of times converges to the same state.
- Fingerprint inputs are part of each rule's contract and are covered by rule tests. Changing
  them is a breaking change that needs a migration plan (bump the rule `version`).
- Hashing happens outside `packages/core` or with a pure-JS hash, because core cannot import
  `node:crypto` (decided in M4).
