# ADR-0004: Money as integer minor units; the model returns money as strings

- Status: Accepted (open sub-question on unit-price precision, see below)
- Date: 2026-09-30
- Source: ARCHITECTURE.md section 15, item 4

## Context

Floating-point money produces rounding errors that would generate false arithmetic findings
(R04) and wrong totals in reports. Invoices come in many locales (`1.234,56`, `1,234.56`,
`1 234,56`) and currencies with different exponents (JPY 0, USD 2, KWD 3).

## Decision

- Money is stored and computed as `bigint` minor units plus a `char(3)` currency code.
- The extraction schema carries amounts as strings in the document's own format plus a
  `decimalSeparator` hint. `packages/shared/money.ts` parses them once, at the boundary, using a
  currency exponent table. Ambiguous formats route to `needs_verification` instead of guessing.
- `decimal.js` is used for parsing only. Logic and storage never see floats.
- The model never does arithmetic the code depends on. Totals are recomputed and cross-checked.

## Open sub-question (to decide before the M2 schema)

`unit_price_minor bigint` cannot represent sub-minor unit prices (e.g. $0.0125 per unit), and
`qty numeric(18,4) x unit price` must also avoid floats. Proposal: store unit prices as a scaled
integer with extra precision and quantities as scaled integers, round to minor units only at
line totals, and express percentage tolerances in basis points. To be recorded as a follow-up
ADR before M2 (tracked in docs/PROGRESS.md, issue C9).

## Consequences

- Property-based tests (fast-check) cover parse/format round trips and arithmetic.
- Every API and export formats money through one helper.
