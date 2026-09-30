import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) };
const exclude = ['**/node_modules/**', '**/.next/**', '**/e2e/**'];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['{apps,packages,tools}/**/*.test.ts'],
          exclude: [...exclude, '**/*.int.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['{apps,packages,tools}/**/*.int.test.ts'],
          exclude,
          environment: 'node',
          // Starts Postgres + Redis (+ S3 with Docker) once, bootstraps roles, migrates.
          globalSetup: ['./tools/devinfra/src/vitest-global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
