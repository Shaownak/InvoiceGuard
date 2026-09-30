import { defineConfig } from 'drizzle-kit';

// Used only by `drizzle-kit generate` to diff the TypeScript schema into SQL migrations.
// Migrations are applied by src/migrate.ts as the owner role, never by drizzle-kit push.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});
