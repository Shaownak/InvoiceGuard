# ADR-0003: AI only reads documents; deterministic rules make every decision

- Status: Accepted
- Date: 2026-09-30
- Source: ARCHITECTURE.md section 15, item 3

## Context

Findings can lead to withheld payments and difficult conversations with vendors. They must be
explainable, reproducible, and testable. Model output is probabilistic, and document content is
attacker-controllable (prompt injection).

## Decision

- The model's only job is extraction: turning a document into JSON that conforms to
  `InvoiceExtractionSchema`. It has a single tool (`record_invoice`) and no side effects.
- Output is Zod-validated. Invalid output is retried once with the validation errors, then the
  invoice is marked `extraction_failed`.
- Every finding comes from a pure, deterministic rule in `packages/core` (R01 to R19) with a unit
  test for each branch and a planted-error case in the synthetic corpus.
- Model output never selects a code path, builds a query, or triggers an action beyond being
  stored as schema-validated data. Low-confidence critical fields stop at `needs_verification`
  for a human to confirm.

## Consequences

- Findings are reproducible: the same data and rule config always give the same findings.
- Swapping or upgrading the model changes extraction accuracy only; the eval harness measures it.
- Rules need normalized, well-typed inputs, so normalization and money parsing are critical
  and property-tested.
- `packages/core` purity is enforced by ESLint (no I/O, clocks or randomness).
