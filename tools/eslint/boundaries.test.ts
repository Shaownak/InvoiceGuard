import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { boundaryConfigs } from './boundaries.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
    ...boundaryConfigs,
  ],
});

/** Lints `code` as if it lived at `path` and returns the rule ids that fired. */
async function rulesFired(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${repoRoot}/${path}` });
  if (result === undefined) throw new Error('no lint result');
  const fatal = result.messages.filter((m) => m.fatal === true);
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('\n'));
  return result.messages.map((m) => m.ruleId ?? 'unknown');
}

const CORE = 'packages/core/src/fixture.ts';

describe('core purity', () => {
  it.each([
    ["import { readFile } from 'node:fs';", 'no-restricted-imports'],
    ["import { readFile } from 'fs';", 'no-restricted-imports'],
    ["import pg from 'pg';", 'no-restricted-imports'],
    ["import { eq } from 'drizzle-orm';", 'no-restricted-imports'],
    ["import { Redis } from 'ioredis';", 'no-restricted-imports'],
    ["import { useState } from 'react';", 'no-restricted-imports'],
    ["import { pino } from 'pino';", 'no-restricted-imports'],
    ["import { createDatabase } from '@invoiceguard/db';", 'no-restricted-imports'],
    ["import { x } from '../../db/src/client';", 'no-restricted-imports'],
    ["import { x } from '../../../packages/db/src/client';", 'no-restricted-imports'],
    ["import { x } from '../../../apps/web/src/server/runtime';", 'no-restricted-imports'],
    ['export const t = Date.now();', 'no-restricted-syntax'],
    ['export const t = new Date();', 'no-restricted-syntax'],
    ['export const r = Math.random();', 'no-restricted-syntax'],
    ['export const e = process.env.X;', 'no-restricted-globals'],
    ["export const f = fetch('https://example.com');", 'no-restricted-globals'],
    ['export const id = crypto.randomUUID();', 'no-restricted-globals'],
    ['export default 1;', 'no-restricted-syntax'],
  ])('rejects %s', async (code, rule) => {
    expect(await rulesFired(CORE, code)).toContain(rule);
  });

  it.each([
    "import { z } from 'zod';\nexport const s = z.string();",
    "import { ConfigError } from '@invoiceguard/shared/errors';\nexport { ConfigError };",
    "import { normalize } from './normalize';\nexport { normalize };",
    "import { r } from '../rules/index';\nexport { r };",
    "import { t } from '../../src/types';\nexport { t };",
    'export const epoch = new Date(0);',
    'export const parse = (iso: string) => new Date(iso);',
  ])('allows %s', async (code) => {
    expect(await rulesFired(CORE, code)).toEqual([]);
  });
});

describe('dependency rule', () => {
  it('forbids shared from importing core or db', async () => {
    const path = 'packages/shared/src/fixture.ts';
    expect(await rulesFired(path, "import { a } from '@invoiceguard/core';")).toContain(
      'no-restricted-imports',
    );
    expect(await rulesFired(path, "import pg from 'pg';")).toContain('no-restricted-imports');
  });

  it('lets library packages use shared and core but not each other or apps', async () => {
    const path = 'packages/storage/src/fixture.ts';
    expect(await rulesFired(path, "import { a } from '@invoiceguard/shared/env';")).toEqual([]);
    expect(await rulesFired(path, "import { a } from '@invoiceguard/core';")).toEqual([]);
    expect(await rulesFired(path, "import { a } from '@invoiceguard/db';")).toContain(
      'no-restricted-imports',
    );
    expect(await rulesFired(path, "import { a } from '@invoiceguard/web';")).toContain(
      'no-restricted-imports',
    );
  });
});

describe('raw database access', () => {
  it('is allowed in packages/db', async () => {
    expect(await rulesFired('packages/db/src/fixture.ts', "import pg from 'pg';")).toEqual([]);
  });

  it.each([
    'apps/web/src/server/fixture.ts',
    'apps/worker/src/fixture.ts',
    'packages/storage/src/fixture.ts',
  ])('is forbidden in %s', async (path) => {
    expect(await rulesFired(path, "import pg from 'pg';")).toContain('no-restricted-imports');
    expect(
      await rulesFired(path, "import { drizzle } from 'drizzle-orm/node-postgres';"),
    ).toContain('no-restricted-imports');
  });
});

describe('default exports', () => {
  it('are rejected in ordinary modules', async () => {
    expect(await rulesFired('apps/worker/src/fixture.ts', 'export default 1;')).toContain(
      'no-restricted-syntax',
    );
  });

  it.each([
    'apps/web/src/app/page.tsx',
    'apps/web/src/app/invoices/[id]/layout.tsx',
    'apps/web/next.config.ts',
    'packages/db/drizzle.config.ts',
  ])('are allowed where the framework requires them: %s', async (path) => {
    expect(await rulesFired(path, 'export default 1;')).toEqual([]);
  });
});
