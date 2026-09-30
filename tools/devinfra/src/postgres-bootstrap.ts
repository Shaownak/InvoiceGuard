import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BOOTSTRAP_SQL = fileURLToPath(
  new URL('../../../infra/postgres/bootstrap-roles.sql', import.meta.url),
);

export const DATABASE_NAME = 'invoiceguard';

export interface BootstrapOptions {
  /** Superuser connection to the maintenance database. */
  adminUrl: string;
  ownerPassword: string;
  appPassword: string;
  database?: string;
}

/**
 * Same steps as infra/postgres/init/10-bootstrap.sh, for native Postgres and Testcontainers:
 * create or update the ig_owner / ig_app roles, then the database owned by ig_owner.
 * Idempotent.
 */
export async function bootstrapPostgres(options: BootstrapOptions): Promise<void> {
  const database = options.database ?? DATABASE_NAME;
  const sql = await readFile(BOOTSTRAP_SQL, 'utf8');
  const client = new pg.Client({ connectionString: options.adminUrl });
  await client.connect();
  try {
    await client.query(`SELECT set_config('ig.owner_password', $1, false)`, [
      options.ownerPassword,
    ]);
    await client.query(`SELECT set_config('ig.app_password', $1, false)`, [options.appPassword]);
    await client.query(sql);
    await createDatabaseIfMissing(client, database);
  } finally {
    await client.end();
  }
}

/** CREATE DATABASE cannot run inside a function or transaction, so it is issued directly. */
export async function createDatabaseIfMissing(client: pg.Client, database: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error('Invalid database name');
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE ${database} OWNER ig_owner`);
  }
}

/** Returns a copy of `url` with credentials and database replaced. */
export function postgresUrl(
  base: { host: string; port: number },
  user: string,
  password: string,
  database: string,
): string {
  const url = new URL('postgres://placeholder');
  url.hostname = base.host;
  url.port = String(base.port);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}
