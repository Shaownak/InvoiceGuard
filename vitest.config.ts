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
    ],
  },
});
