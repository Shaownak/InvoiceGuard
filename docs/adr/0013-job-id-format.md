# ADR-0013: Deterministic job IDs use `.` as separator (`extract.{invoiceId}`)

- Status: Accepted
- Date: 2026-09-30
- Deviation from: ARCHITECTURE.md section 6 (`extract:{invoiceId}`, `match:{invoiceId}`)

## Context

ARCHITECTURE.md specifies deterministic job IDs so that double-enqueueing is harmless. An
integration test against real Redis showed that BullMQ 6 rejects custom job IDs containing
`:` ("Custom Id cannot contain :"), because it uses `:` in its own key namespace.

## Decision

- Job IDs are built only by `deterministicJobId(kind, entityId)` in
  `packages/shared/src/queues.ts`, producing `kind.entityId` (e.g.
  `extract.0192f3a4-1b2c-7d3e-8f40-123456789abc`).
- `kind` must match `^[a-z][a-z0-9-]*$` and `entityId` must match `^[A-Za-z0-9-]+$`, so the
  format is unambiguous and cannot contain BullMQ-reserved characters.

## Consequences

- The idempotency guarantee is unchanged. An integration test enqueues the same deterministic
  ID twice and gets one job (`apps/worker/src/workers.int.test.ts`).
- ARCHITECTURE.md section 6 is updated to the new format.
