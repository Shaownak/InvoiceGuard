# InvoiceGuard

Multi-tenant SaaS that audits supplier invoices before payment. AI reads documents;
deterministic, tested rules decide what gets flagged for review.

- Product requirements: [SPEC.md](SPEC.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/adr/](docs/adr/)
- Status: [docs/PROGRESS.md](docs/PROGRESS.md)
- Contributor and agent rules: [CLAUDE.md](CLAUDE.md)

## Quick start

Requires Node 24 and pnpm 10. Docker is optional. On Windows, clone to a short path (under
about 90 characters): embedded Postgres binaries hit the 260-character path limit otherwise.

```bash
pnpm install
cp .env.example .env
```

With Docker:

```bash
pnpm services:docker && pnpm db:migrate && pnpm dev
```

Without Docker (embedded Postgres, Redis-compatible server, filesystem storage):

```bash
pnpm dev:native
```

Then open http://localhost:3000 and http://localhost:3000/api/health.

Before every commit: `pnpm check`.
