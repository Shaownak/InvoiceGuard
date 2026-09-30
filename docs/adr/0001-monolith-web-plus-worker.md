# ADR-0001: Monolith with two processes (web + worker), not microservices

- Status: Accepted
- Date: 2026-09-30
- Source: ARCHITECTURE.md section 15, item 1

## Context

InvoiceGuard has two kinds of work: request/response (UI, REST API, webhooks) and slow
background jobs (extraction calls to an AI provider, matching, rules, report rendering). The
team is small, the domain is still being discovered, and correctness across the pipeline
matters more than independent scaling of individual components.

## Decision

One repository and one codebase, deployed as two processes that share one Postgres database
and one Redis:

- `apps/web`: Next.js (UI, `/api/v1`, webhooks, health endpoints).
- `apps/worker`: BullMQ processors (extract, match, report).

All business logic lives in framework-free packages (`packages/core`, `shared`, `db`, and so on)
that both processes import. Package boundaries are enforced by ESLint
(`tools/eslint/boundaries.js`), not by network hops.

## Consequences

- One deploy pipeline, one migration history, one set of types end to end.
- Web and worker scale independently (replica counts) without service-to-service APIs.
- Long jobs never block web requests; the queue gives retries, backoff and rate limits.
- If a component ever needs separate scaling or isolation (e.g. PDF rendering), it can be
  split along an existing package boundary later.
