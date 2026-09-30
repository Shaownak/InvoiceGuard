import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, UnsafeDatabaseRoleError } from './client';
import { runMigrations } from './migrate';
import { OWNER_ROLE } from './roles';

const infra = inject('testInfra');

/** Recreates an empty (unmigrated) database owned by ig_owner; returns an owner URL for it. */
async function createScratchDatabase(name: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid database name');
  await withClient(infra.postgres.adminUrl, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${name} OWNER ${OWNER_ROLE}`);
  });
  const url = new URL(infra.postgres.ownerUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('migrations', () => {
  it('apply to an empty database and are idempotent on re-run', async () => {
    const scratchUrl = await createScratchDatabase('ig_migration_test');
    const first = await runMigrations(scratchUrl);
    expect(first.appliedBefore).toBe(0);
    expect(first.appliedAfter).toBeGreaterThanOrEqual(1);

    const second = await runMigrations(scratchUrl);
    expect(second.appliedBefore).toBe(first.appliedAfter);
    expect(second.appliedAfter).toBe(first.appliedAfter);
  });

  it('install the required extensions', async () => {
    const names = await withClient(infra.postgres.ownerUrl, async (c) => {
      const res = await c.query<{ extname: string }>('SELECT extname FROM pg_extension');
      return res.rows.map((r) => r.extname);
    });
    expect(names).toEqual(expect.arrayContaining(['pgcrypto', 'citext', 'pg_trgm']));
  });
});

describe('app role (the foundation for row-level security)', () => {
  it('is not a superuser and cannot bypass RLS', async () => {
    const role = await withClient(infra.postgres.appUrl, async (c) => {
      const res = await c.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      return res.rows[0];
    });
    expect(role).toEqual({ rolname: 'ig_app', rolsuper: false, rolbypassrls: false });
  });

  it('is not a member of the owner role', async () => {
    const isMember = await withClient(infra.postgres.appUrl, async (c) => {
      const res = await c.query<{ member: boolean }>(
        `SELECT pg_has_role(current_user, 'ig_owner', 'MEMBER') AS member`,
      );
      return res.rows[0]?.member;
    });
    expect(isMember).toBe(false);
  });

  it('cannot create tables or schemas (no DDL)', async () => {
    await withClient(infra.postgres.appUrl, async (c) => {
      await expect(c.query('CREATE TABLE public.sneaky (id int)')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(c.query('CREATE SCHEMA sneaky')).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('gets DML rights on tables the owner creates later (default privileges)', async () => {
    // In a scratch database: a committed probe table in the shared test database would trip
    // the RLS enumeration test (rls.int.test.ts) running in parallel.
    const ownerUrl = await createScratchDatabase('ig_grant_probe');
    await runMigrations(ownerUrl);
    const appUrl = new URL(infra.postgres.appUrl);
    appUrl.pathname = '/ig_grant_probe';
    await withClient(ownerUrl, (c) => c.query('CREATE TABLE public.m0_grant_probe (id int)'));
    await withClient(appUrl.toString(), async (c) => {
      await c.query('INSERT INTO public.m0_grant_probe VALUES (1)');
      const res = await c.query('SELECT count(*) FROM public.m0_grant_probe');
      expect(res.rowCount).toBe(1);
      await expect(c.query('DROP TABLE public.m0_grant_probe')).rejects.toMatchObject({
        code: '42501',
      });
    });
  });
});

describe('uuid_generate_v7()', () => {
  let ids: string[] = [];
  let before = 0;
  let after = 0;

  beforeAll(async () => {
    before = Date.now();
    ids = await withClient(infra.postgres.appUrl, async (c) => {
      const out: string[] = [];
      for (let batch = 0; batch < 5; batch++) {
        const res = await c.query<{ id: string }>(
          'SELECT uuid_generate_v7()::text AS id FROM generate_series(1, 200)',
        );
        out.push(...res.rows.map((r) => r.id));
        await c.query('SELECT pg_sleep(0.003)');
      }
      return out;
    });
    after = Date.now();
  });

  it('produces RFC 9562 version 7 / variant 10 UUIDs', () => {
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('embeds the current Unix time in milliseconds', () => {
    for (const id of ids) {
      const ms = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
      // Allow for clock skew between the test process and the database server.
      expect(ms).toBeGreaterThanOrEqual(before - 1_000);
      expect(ms).toBeLessThanOrEqual(after + 1_000);
    }
  });

  it('is unique and time-ordered at millisecond granularity', () => {
    expect(new Set(ids).size).toBe(ids.length);
    const prefixes = ids.map((id) => id.slice(0, 13));
    expect([...prefixes].sort()).toEqual(prefixes);
  });
});

describe('createDatabase', () => {
  const db = createDatabase(infra.postgres.appUrl, { applicationName: 'ig-test' });
  afterAll(() => db.close());

  it('pings a reachable database', async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });

  it('refuses to report healthy when connected as a role that bypasses RLS', async () => {
    const owner = createDatabase(infra.postgres.ownerUrl, { applicationName: 'ig-test' });
    try {
      await expect(owner.ping()).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    } finally {
      await owner.close();
    }
  });

  it('fails fast when the database is unreachable', async () => {
    const url = new URL(infra.postgres.appUrl);
    url.port = '1';
    const broken = createDatabase(url.toString(), {
      applicationName: 'ig-test',
      connectionTimeoutMs: 1_000,
    });
    const started = Date.now();
    await expect(broken.ping()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    await broken.close();
  });
});
