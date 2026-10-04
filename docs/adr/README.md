# Architecture decision records

One file per decision: context, decision, consequences. Deviations from SPEC.md or
ARCHITECTURE.md are recorded here (CLAUDE.md). Superseded ADRs stay, marked as superseded.

| ADR                                                     | Title                                                         | Status                                   |
| ------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| [0001](0001-monolith-web-plus-worker.md)                | Monolith with two processes (web + worker)                    | Accepted                                 |
| [0002](0002-postgres-rls-tenant-isolation.md)           | Postgres RLS for tenant isolation; `withOrg` only entry point | Accepted                                 |
| [0003](0003-ai-reads-code-decides.md)                   | AI only reads; deterministic rules decide                     | Accepted                                 |
| [0004](0004-money-as-integer-minor-units.md)            | Money as integer minor units                                  | Accepted (unit-price precision open, C9) |
| [0005](0005-extraction-provider-interface-with-mock.md) | Extraction provider interface with mock                       | Accepted                                 |
| [0006](0006-idempotent-findings-via-fingerprints.md)    | Idempotent findings via fingerprints                          | Accepted                                 |
| [0007](0007-own-auth.md)                                | Own auth on argon2id + DB sessions (not Auth.js)              | Accepted                                 |
| [0008](0008-health-endpoints.md)                        | Health endpoints: readiness and liveness                      | Accepted                                 |
| [0009](0009-environment-validation.md)                  | Per-process, conditional env validation                       | Accepted                                 |
| [0010](0010-monorepo-tooling.md)                        | Monorepo tooling choices                                      | Accepted                                 |
| [0011](0011-native-dev-services.md)                     | Run with or without Docker                                    | Accepted (deviation)                     |
| [0012](0012-s3-compatible-dev-storage.md)               | RustFS instead of MinIO                                       | Accepted (deviation)                     |
| [0013](0013-job-id-format.md)                           | Job ID separator `.`                                          | Accepted (deviation)                     |
| [0014](0014-uuid-v7-in-database.md)                     | UUID v7 generated in the database                             | Accepted                                 |
| [0015](0015-database-access-contexts.md)                | DB access contexts, RLS on every table, definer lookups       | Accepted (amends 0002)                   |
| [0016](0016-append-only-audit-log.md)                   | Append-only, org-scoped audit log                             | Accepted (purge path in M8)              |
| [0017](0017-email-transports-and-links.md)              | Email transports (SMTP/file), tokens in URL fragments         | Accepted                                 |
