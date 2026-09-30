# ADR-0009: Per-process, conditional environment validation

- Status: Accepted
- Date: 2026-09-30
- Resolves: spec gap C3 (ARCHITECTURE.md section 14 lists every variable as validated at boot)

## Context

ARCHITECTURE.md section 14 lists all environment variables, including Stripe and Anthropic keys,
as validated in `packages/shared/env.ts`. Requiring all of them in every process would force
developers and CI to hold live secrets from M0 onward, and would stop the migration runner
because a billing key is missing.

## Decision

- `packages/shared/src/env.ts` exports one Zod schema per process: `webEnvSchema`,
  `workerEnvSchema`, `migrateEnvSchema`, `storageEnvSchema`. Each process parses only what it
  uses, at boot (`instrumentation.ts` for web, top of `main.ts` for the worker and CLIs).
- Conditional requirements live next to the variable:
  - `STORAGE_DRIVER=s3` requires `S3_*`; `STORAGE_DRIVER=fs` requires `STORAGE_FS_ROOT`.
  - `STORAGE_DRIVER=fs` is rejected when `NODE_ENV=production`.
  - From M3: `ANTHROPIC_API_KEY` is required only when `EXTRACTION_PROVIDER=anthropic`.
  - From M7: Stripe keys are required when billing is enabled or `NODE_ENV=production`.
- Empty strings count as unset (`FOO=` in a `.env` file).
- Errors list variable names and reasons only, never values (they may be secrets). A test
  asserts this.
- A root `.env` is loaded for local development only; real environment variables always win,
  so CI and production are unaffected. `.env.example` lists exactly the variables validated
  so far and grows with each milestone.

## Consequences

- A misconfigured deployment fails at boot with an actionable message (verified: `next start`
  with the dev-only fs driver refuses to start).
- Adding a variable means updating the schema, its test, and `.env.example` in the same commit.
