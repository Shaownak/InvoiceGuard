# ADR-0008: Health endpoints: `/api/health` (readiness) and `/api/health/live` (liveness)

- Status: Accepted
- Date: 2026-09-30
- Resolves: spec contradiction C1 (SPEC.md section 11 M0 vs ARCHITECTURE.md section 9)

## Context

SPEC.md's M0 acceptance requires `/api/health` to check the database, Redis and storage.
ARCHITECTURE.md section 9 lists `GET /health | /health/ready` under the versioned `/api/v1`
prefix. Orchestrators need two distinct signals: "restart me" (liveness) and "don't route
traffic to me" (readiness). A liveness probe that checks dependencies causes restart storms
when a shared dependency blips.

## Decision

- `GET /api/health`: **readiness**. Checks database (`SELECT 1` as the app role), Redis
  (`PING`) and object storage (bucket `HeadBucket`, or directory access for the fs driver), in
  parallel with a 2 s timeout each. Returns 200 `{status:"ok", checks:{...}}` when all pass,
  503 `{status:"unavailable", ...}` otherwise, with `Cache-Control: no-store`.
- `GET /api/health/live`: **liveness**. Returns 200 with no dependency checks.
- Both are **unversioned**. Probe URLs are infrastructure configuration and should not move
  when the public API version changes.
- The response names the failing dependency but never includes error messages (they can
  contain hostnames or credentials). Details go to the server log.
- Invalid configuration returns the standard error shape with a generic 500 message.

## Consequences

- ARCHITECTURE.md section 9 is updated to list these paths.
- Implementation: `apps/web/src/server/health.ts` (testable runner) and
  `apps/web/src/app/api/health/**/route.ts`. Unit tests cover timeout and leak prevention;
  integration tests cover real dependencies, a stopped Redis, and bad credentials.
- The worker has no HTTP server yet. Its health is BullMQ connectivity, visible through the
  queue admin page planned for M8.
