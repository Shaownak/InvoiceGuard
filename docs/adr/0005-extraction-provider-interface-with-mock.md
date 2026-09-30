# ADR-0005: Extraction behind a provider interface, with a mock for offline work

- Status: Accepted (implemented in M3)
- Date: 2026-09-30
- Source: ARCHITECTURE.md section 15, item 5

## Context

Development, CI, demos and the ground-truth suite must run without network calls or API
spend (CLAUDE.md testing rules). Model choice and pricing will change, and lock-in to one
vendor is a listed risk (SPEC.md section 12).

## Decision

- `packages/extraction` defines `ExtractionProvider` (ARCHITECTURE.md section 7).
- `AnthropicProvider` uses a single forced tool (`record_invoice`) whose JSON schema is
  generated from the Zod schema, with prompt caching on the static system prompt. The model
  comes from `EXTRACTION_MODEL`.
- `MockProvider` replays ground truth from `packages/testdata`, with optional injected noise
  (dropped fields, lowered confidence) to exercise the verification path.
- `EXTRACTION_PROVIDER=mock|anthropic` selects the implementation. Env validation requires
  `ANTHROPIC_API_KEY` only when `anthropic` is selected (ADR-0009).
- Prompts are versioned files; the version is stored on every extraction row.
- Cost is computed locally from a pricing table (`pricing.ts`), configurable by env.

## Consequences

- `pnpm check` and CI never call a live API. The live path is exercised on demand by
  `pnpm eval:extraction` with a key present.
- Switching models is a config change validated by the eval harness thresholds.
