// Architecture guardrails enforced by ESLint (ARCHITECTURE.md section 3, CLAUDE.md rules 3-4).
//
//  - Dependency rule: core and shared depend on nothing internal (core may use shared);
//    library packages may use shared and core; apps may use anything.
//  - core is pure: no Node builtins, DB, network, framework or logging imports; no clocks,
//    randomness, timers or process access.
//  - Raw Postgres drivers are allowed only inside packages/db, so app code cannot bypass
//    withOrg() and row-level security. Likewise only packages/db may name the
//    `app.org_id` / `app.user_id` settings, so nothing else can switch its own tenant context.
//  - Named exports only, except files where a framework or tool requires a default export.
//
// Flat config does not merge options of the same rule across config objects, so every
// scope below gets its complete rule options built from these lists.
import { builtinModules } from 'node:module';

const NODE_BUILTINS = [...builtinModules.filter((m) => !m.startsWith('_')), 'node:*'];
const DB_DRIVERS = [
  'pg',
  'pg-*',
  'postgres',
  'drizzle-orm/node-postgres',
  'drizzle-orm/node-postgres/*',
];
const INFRA_CLIENTS = [
  'ioredis',
  'bullmq',
  '@aws-sdk/*',
  'nodemailer',
  'stripe',
  '@anthropic-ai/sdk',
];
const FRAMEWORKS = ['next', 'next/*', 'react', 'react/*', 'react-dom', 'react-dom/*'];
const ORM = ['drizzle-orm', 'drizzle-orm/*'];
const LOGGING = ['pino', 'pino-*'];

// Relative imports must stay inside their own package.
// Matches paths that climb (`../`) into another package's src, or into a workspace folder.
const CROSS_PACKAGE_RELATIVE = {
  regex: String.raw`^(\.\./)+((apps|packages|tools)(/|$)|[^./][^/]*/src(/|$))`,
  message: 'Import other workspace packages by name (@invoiceguard/...), not by relative path.',
};

const internalExcept = (allowed, who) => ({
  group: [
    '@invoiceguard/*',
    ...allowed.flatMap((p) => [`!@invoiceguard/${p}`, `!@invoiceguard/${p}/*`]),
  ],
  message: `${who} may only depend on: ${allowed.length ? allowed.map((p) => `@invoiceguard/${p}`).join(', ') : 'no internal packages'} (ARCHITECTURE.md section 3).`,
});

const banned = (list, message) => ({ group: list, message });

const DRIVER_BAN = banned(
  DB_DRIVERS,
  'Raw Postgres access is only allowed in packages/db. Use the db package (withOrg) instead.',
);

// ---------------------------------------------------------------------------------------
// no-restricted-syntax selectors
// ---------------------------------------------------------------------------------------
const NO_DEFAULT_EXPORT = {
  selector: 'ExportDefaultDeclaration',
  message: 'Use named exports (CLAUDE.md code conventions).',
};

// String or template literals naming the row-level security context settings.
const CONTEXT_SETTING = String.raw`/app\.(org|user)_id/`;
const RLS_CONTEXT_SYNTAX = [
  {
    selector: `Literal[value=${CONTEXT_SETTING}]`,
    message: 'Only packages/db sets the RLS context (app.org_id / app.user_id). Use withOrg().',
  },
  {
    selector: `TemplateElement[value.raw=${CONTEXT_SETTING}]`,
    message: 'Only packages/db sets the RLS context (app.org_id / app.user_id). Use withOrg().',
  },
];

const PURITY_SYNTAX = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'packages/core is pure: pass `now` in instead of calling Date.now().',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'packages/core is pure: pass `now` in instead of new Date().',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'packages/core is pure: no randomness.',
  },
];

const PURITY_GLOBALS = [
  'process',
  'fetch',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'crypto',
  'performance',
  'XMLHttpRequest',
  'WebSocket',
  'localStorage',
  'sessionStorage',
  'require',
].map((name) => ({ name, message: `packages/core is pure: \`${name}\` is not allowed.` }));

// Files that must default-export (framework or tool conventions).
export const DEFAULT_EXPORT_ALLOWED = [
  '**/*.config.{js,mjs,cjs,ts,mts}',
  'apps/web/src/app/**/{page,layout,template,loading,error,global-error,not-found,default}.tsx',
  'apps/web/src/app/**/{opengraph-image,twitter-image,icon,apple-icon}.{ts,tsx}',
  'apps/web/src/app/{sitemap,robots,manifest}.ts',
];

const LIBRARY_PACKAGES = ['extraction', 'storage', 'testdata', 'billing', 'reports'];

/** @type {import('eslint').Linter.Config[]} */
export const boundaryConfigs = [
  {
    name: 'invoiceguard/named-exports',
    files: ['{apps,packages,tools}/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT, ...RLS_CONTEXT_SYNTAX],
      'no-restricted-imports': ['error', { patterns: [CROSS_PACKAGE_RELATIVE] }],
    },
  },
  {
    name: 'invoiceguard/apps',
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CROSS_PACKAGE_RELATIVE, DRIVER_BAN] }],
    },
  },
  {
    name: 'invoiceguard/core-purity',
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            CROSS_PACKAGE_RELATIVE,
            internalExcept(['shared'], 'packages/core'),
            banned(NODE_BUILTINS, 'packages/core is pure: no Node built-ins (I/O).'),
            banned([...DB_DRIVERS, ...ORM], 'packages/core is pure: no database access.'),
            banned(INFRA_CLIENTS, 'packages/core is pure: no network or queue clients.'),
            banned(FRAMEWORKS, 'packages/core is pure: no framework code.'),
            banned(LOGGING, 'packages/core is pure: return data, do not log.'),
          ],
        },
      ],
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT, ...RLS_CONTEXT_SYNTAX, ...PURITY_SYNTAX],
      'no-restricted-globals': ['error', ...PURITY_GLOBALS],
    },
  },
  {
    name: 'invoiceguard/shared',
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            CROSS_PACKAGE_RELATIVE,
            internalExcept([], 'packages/shared'),
            banned([...DB_DRIVERS, ...ORM], 'packages/shared must not touch the database.'),
            banned(INFRA_CLIENTS, 'packages/shared must not depend on infrastructure clients.'),
            banned(FRAMEWORKS, 'packages/shared must stay framework-free.'),
          ],
        },
      ],
    },
  },
  {
    // packages/db owns the RLS context (withOrg / withUser); this file and its test define
    // and exercise the rule, so they name the settings too.
    name: 'invoiceguard/rls-context-owners',
    files: ['packages/db/**/*.ts', 'tools/eslint/**/*.{js,ts}'],
    rules: { 'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT] },
  },
  {
    name: 'invoiceguard/db',
    files: ['packages/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            CROSS_PACKAGE_RELATIVE,
            internalExcept(['shared', 'core'], 'packages/db'),
            banned(FRAMEWORKS, 'Library packages must stay framework-free.'),
          ],
        },
      ],
    },
  },
  {
    name: 'invoiceguard/library-packages',
    files: LIBRARY_PACKAGES.map((p) => `packages/${p}/**/*.ts`),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            CROSS_PACKAGE_RELATIVE,
            internalExcept(['shared', 'core'], 'Library packages'),
            DRIVER_BAN,
            banned(FRAMEWORKS, 'Library packages must stay framework-free.'),
          ],
        },
      ],
    },
  },
  {
    name: 'invoiceguard/default-export-exceptions',
    files: DEFAULT_EXPORT_ALLOWED,
    rules: { 'no-restricted-syntax': ['error', ...RLS_CONTEXT_SYNTAX] },
  },
];
