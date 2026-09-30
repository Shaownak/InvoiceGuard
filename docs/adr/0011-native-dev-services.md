# ADR-0011: Local development and tests must run with or without Docker

- Status: Accepted
- Date: 2026-09-30
- Deviation from: SPEC.md M0 / ARCHITECTURE.md section 14 (Docker Compose as the only local
  path) and section 12 (Testcontainers for integration tests). Requested in chat: the primary
  development machine is a managed office PC where virtualization (and therefore Docker and
  WSL) cannot be enabled without IT.

## Decision

Two interchangeable ways to run backing services, selected by the developer:

| Service        | Docker (`pnpm services:docker`) | Native (`pnpm services:native`, `pnpm dev:native`)                                                                    |
| -------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Postgres 16    | `postgres:16.15-alpine`         | `embedded-postgres` 16.14 (official server binaries from npm, no admin rights). Data in `.local/postgres`             |
| Redis          | `redis:8.4.7-alpine`            | `redis-memory-server`: Memurai Developer (Redis 8.2 compatible) on Windows, a Redis source build elsewhere. In-memory |
| Object storage | RustFS (S3 API), see ADR-0012   | `STORAGE_DRIVER=fs` (`.local/storage`), forbidden in production                                                       |
| Email          | Mailpit                         | not yet needed. M1 adds a native option (Mailpit is a single binary) or a file transport                              |

- Both paths use the **same** role bootstrap SQL (`infra/postgres/bootstrap-roles.sql`): the
  Docker init script runs it with psql; `tools/devinfra` runs it with `pg`.
- The native runner reads ports and credentials from `.env`, bootstraps roles, applies
  migrations, and with `--dev` starts web and worker. Ctrl+C stops everything.
- Integration tests pick infra through `IG_TEST_INFRA=docker|native|auto` (default `auto`:
  Docker if a runtime is reachable, otherwise native). The global setup starts services once,
  bootstraps and migrates, and provides connection details via Vitest `provide/inject`.
- Tests that need an S3 server run only in Docker mode. Native mode skips them and prints
  that it did. CI runs both modes: `check` (ubuntu, Docker) and `check-native` (Windows).

## Consequences

- `pnpm check` works on this machine with no Docker. The S3 driver's real-server tests are
  CI-only here.
- Fidelity: embedded Postgres is the real server (minor version 16.14 vs 16.15 in Docker).
  Memurai is Redis-protocol compatible and BullMQ's integration tests pass against it. Docker
  in CI remains the reference environment.
- Memurai Developer is licensed for development and testing only. It is never used in
  deployed environments.
- Production-mode local runs (`pnpm start`) need S3, because the fs driver is refused when
  `NODE_ENV=production`. Local e2e uses the dev server.
