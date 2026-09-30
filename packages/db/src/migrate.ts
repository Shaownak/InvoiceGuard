import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export interface MigrationResult {
  appliedBefore: number;
  appliedAfter: number;
}

/**
 * Applies pending SQL migrations. Must run as the owner role (DATABASE_OWNER_URL): the app
 * role has no DDL rights. Safe to run repeatedly; already-applied migrations are skipped.
 */
export async function runMigrations(ownerUrl: string): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString: ownerUrl, application_name: 'ig-migrate' });
  await client.connect();
  try {
    const before = await countApplied(client);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    const after = await countApplied(client);
    return { appliedBefore: before, appliedAfter: after };
  } finally {
    await client.end();
  }
}

async function countApplied(client: pg.Client): Promise<number> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );
  if (exists.rows[0]?.exists !== true) return 0;
  const res = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations',
  );
  return Number(res.rows[0]?.count ?? 0);
}
