import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * Helpers for integration tests. Fixtures are written through the owner role, which row-level
 * security does not bind, so tests set up state without depending on the code under test.
 * Never imported by application code.
 */

export async function withPgClient<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Runs `fn` as the app role inside a transaction with the given context, then rolls back.
 * Raw SQL on purpose: the cross-tenant suite probes the database itself, below `withOrg`.
 */
export async function asApp<T>(
  appUrl: string,
  context: { orgId?: string; userId?: string },
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return withPgClient(appUrl, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)`,
        [context.orgId ?? '', context.userId ?? ''],
      );
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

export interface SeededUser {
  userId: string;
  email: string;
}

export interface SeededTenant {
  orgId: string;
  owner: SeededUser;
}

/** Inserts a verified user (password hash is a placeholder, not a usable hash). */
export async function seedUser(
  ownerUrl: string,
  options: { verified?: boolean } = {},
): Promise<SeededUser> {
  const email = uniqueEmail();
  return withPgClient(ownerUrl, async (c) => {
    const res = await c.query<{ id: string }>(
      `INSERT INTO users (email, name, email_verified_at) VALUES ($1, $2, $3) RETURNING id`,
      [email, 'Test User', options.verified === false ? null : new Date()],
    );
    const userId = res.rows[0]?.id;
    if (userId === undefined) throw new Error('user insert failed');
    await c.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, 'x')`, [
      userId,
    ]);
    return { userId, email };
  });
}

/** Inserts an organization with a new owner. */
export async function seedTenant(ownerUrl: string, name = 'Test Org'): Promise<SeededTenant> {
  const owner = await seedUser(ownerUrl);
  const orgId = await withPgClient(ownerUrl, async (c) => {
    const res = await c.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [name, `test-${randomBytes(6).toString('hex')}`],
    );
    const id = res.rows[0]?.id;
    if (id === undefined) throw new Error('org insert failed');
    await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      id,
      owner.userId,
    ]);
    return id;
  });
  return { orgId, owner };
}

export async function seedMembership(
  ownerUrl: string,
  orgId: string,
  userId: string,
  role: string,
): Promise<string> {
  return withPgClient(ownerUrl, async (c) => {
    const res = await c.query<{ id: string }>(
      `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, userId, role],
    );
    const id = res.rows[0]?.id;
    if (id === undefined) throw new Error('membership insert failed');
    return id;
  });
}

export type Attempt =
  { ok: true; rowCount: number; rows: Record<string, unknown>[] } | { ok: false; code: string };

/**
 * Runs one statement inside a savepoint, so an expected failure does not abort the
 * surrounding transaction. Returns the row count, or the SQLSTATE of the failure.
 */
export async function attempt(
  client: pg.Client,
  text: string,
  values?: unknown[],
): Promise<Attempt> {
  await client.query('SAVEPOINT attempt');
  try {
    const res = await client.query<Record<string, unknown>>(text, values);
    await client.query('RELEASE SAVEPOINT attempt');
    return { ok: true, rowCount: res.rowCount ?? 0, rows: res.rows };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
      return { ok: false, code: err.code };
    }
    throw err;
  }
}
