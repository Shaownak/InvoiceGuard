# ADR-0010: Monorepo tooling choices

- Status: Accepted
- Date: 2026-09-30

## Decision

| Concern            | Choice                                                                                                    | Why                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Package manager    | pnpm 10 workspaces, pinned via `packageManager`                                                           | As specified. Strict node_modules catches undeclared deps. Build scripts allowed only via `onlyBuiltDependencies`                 |
| Task runner        | none (`pnpm -r`, `--parallel`, `--filter`)                                                                | Nine small packages don't need Turborepo; one less dependency                                                                     |
| Node               | 24 LTS (`.nvmrc`, `engines`)                                                                              | Current LTS. Provides `process.loadEnvFile`                                                                                       |
| TypeScript         | **6.0.x, not 7.x**                                                                                        | `typescript@latest` is 7.0 (native port), but typescript-eslint supports `<6.1`. Revisit when typescript-eslint supports TS 7     |
| Internal packages  | Consumed as TypeScript source (`exports` points at `src/*.ts`), no build step                             | Next.js uses `transpilePackages`; worker and CLIs run with `tsx`. A production worker bundle is an M9 concern                     |
| Strictness         | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `verbatimModuleSyntax`   | `exactOptionalPropertyTypes` deliberately off: poor ergonomics with Zod/Drizzle types                                             |
| Lint               | ESLint 10 flat config, typescript-eslint `strictTypeChecked`, Next plugin, Prettier compat                | Type-aware rules catch floating promises and unsafe `any`                                                                         |
| Architecture rules | `tools/eslint/boundaries.js` (`no-restricted-imports`, `-syntax`, `-globals`)                             | Encodes ARCHITECTURE.md section 3 and core purity without extra plugins. `tools/eslint/boundaries.test.ts` proves each rule fires |
| Format             | Prettier (single quotes, width 100, LF). `.gitattributes` forces LF                                       | CRLF breaks shell scripts mounted into Linux containers. Hand-written source docs are excluded                                    |
| Tests              | Vitest 5 with two projects: `unit` (`*.test.ts`) and `integration` (`*.int.test.ts`, shared global setup) | Integration infra starts once per run                                                                                             |
| E2E                | Playwright (chromium) in `apps/web/e2e`                                                                   | As specified                                                                                                                      |
| Logging            | pino JSON with a central redaction list                                                                   | As specified. No pino-pretty dependency                                                                                           |

## Consequences

- `pnpm check` = lint, format check, typecheck (every package plus root), unit, integration.
  The ground-truth suite joins at M4 (issue C2 in docs/PROGRESS.md).
- Optional native builds (`ssh2`, `cpu-features`, `msgpackr-extract`, `protobufjs`) are
  explicitly ignored. All have JS fallbacks, and building them needs a C toolchain.
