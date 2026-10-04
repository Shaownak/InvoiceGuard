import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Tx } from './client';
import { getOrganization } from './repos/organizations';
import { findRlsProblems, listTenantTables } from './rls-audit';
import { auditLog, invites, memberships } from './schema';
import {
  asApp,
  attempt,
  seedMembership,
  seedTenant,
  seedUser,
  uniqueEmail,
  withPgClient,
  type Attempt,
  type SeededTenant,
} from './testing';

// M1 acceptance: a user in org B can never read or write org A data at the database level,
// even when application code forgets an org_id filter (ARCHITECTURE.md section 5).
//
// Every tenant table (any table with org_id) registers a factory for a valid row. The
// enumeration test below fails when a tenant table has no factory, so a new table cannot
// skip the cross-tenant checks.

const infra = inject('testInfra');
const OWNER = infra.postgres.ownerUrl;
const APP = infra.postgres.appUrl;
const INSUFFICIENT_PRIVILEGE = '42501';

type Fixture = (ctx: { orgId: string; spareUserId: string }) => Record<string, unknown>;

const TENANT_FIXTURES: Record<string, Fixture> = {
  memberships: ({ orgId, spareUserId }) => ({
    org_id: orgId,
    user_id: spareUserId,
    role: 'viewer',
  }),
  invites: ({ orgId }) => ({
    org_id: orgId,
    email: uniqueEmail('invitee'),
    role: 'viewer',
    token_hash: randomBytes(32),
    expires_at: new Date(Date.now() + 86_400_000),
  }),
  audit_log: ({ orgId }) => ({
    org_id: orgId,
    action: 'org.created',
    entity_type: 'organization',
  }),
};

function insertStatement(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  return {
    text: `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')})
           VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')}) RETURNING *`,
    values: Object.values(row),
  };
}

async function insertAsOwner(table: string, row: Record<string, unknown>) {
  return withPgClient(OWNER, async (c) => {
    const { text, values } = insertStatement(table, row);
    const res = await c.query<Record<string, unknown> & { id: string }>(text, values);
    const inserted = res.rows[0];
    if (inserted === undefined) throw new Error(`insert into ${table} returned nothing`);
    return inserted;
  });
}

async function readAsOwner(table: string, id: string) {
  return withPgClient(OWNER, async (c) => {
    const res = await c.query(`SELECT * FROM "${table}" WHERE id = $1`, [id]);
    return res.rows[0] as unknown;
  });
}

/** A write that must not touch the target: zero rows affected, or refused outright. */
function expectNoEffect(result: Attempt): void {
  if (result.ok) expect(result.rowCount).toBe(0);
  else expect(result.code).toBe(INSUFFICIENT_PRIVILEGE);
}

async function publicTables(): Promise<string[]> {
  return withPgClient(OWNER, async (c) => {
    const res = await c.query<{ t: string }>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
    );
    return res.rows.map((r) => r.t);
  });
}

let orgA: SeededTenant;
let orgB: SeededTenant;

beforeAll(async () => {
  [orgA, orgB] = await Promise.all([seedTenant(OWNER, 'Org A'), seedTenant(OWNER, 'Org B')]);
});

describe('RLS enumeration', () => {
  it('finds no table, policy, view or definer function outside the rules', async () => {
    const problems = await withPgClient(OWNER, (c) => findRlsProblems(c));
    expect(problems).toEqual([]);
  });

  it('has a cross-tenant fixture for every table with an org_id column', async () => {
    const tenantTables = await withPgClient(OWNER, (c) => listTenantTables(c));
    expect(tenantTables).toEqual(Object.keys(TENANT_FIXTURES).sort());
  });

  it('catches a new tenant table without RLS, a permissive policy, a view and a definer', async () => {
    await withPgClient(OWNER, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('CREATE TABLE rls_probe (id uuid PRIMARY KEY, org_id uuid NOT NULL)');
        const forProbe = async () =>
          (await findRlsProblems(c)).filter((p) => p.object.startsWith('rls_probe'));

        expect(await forProbe()).toEqual([
          { object: 'rls_probe', problem: 'row-level security is not enabled' },
          { object: 'rls_probe', problem: 'has no policy' },
        ]);

        await c.query('ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY');
        await c.query('CREATE POLICY wide_open ON rls_probe USING (true)');
        expect(await forProbe()).toEqual([
          { object: 'rls_probe.wide_open', problem: 'tenant policy does not check app_org_id()' },
        ]);

        await c.query('DROP POLICY wide_open ON rls_probe');
        await c.query(
          `CREATE POLICY scoped ON rls_probe
           USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id())`,
        );
        expect(await forProbe()).toEqual([]);

        await c.query('CREATE VIEW rls_probe_view AS SELECT * FROM rls_probe');
        await c.query(
          `CREATE FUNCTION rls_probe_fn() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`,
        );
        expect(await forProbe()).toEqual([
          { object: 'rls_probe_view', problem: 'view lacks security_invoker' },
          { object: 'rls_probe_fn()', problem: 'unreviewed SECURITY DEFINER function' },
        ]);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });

  it('gives the app role no TRUNCATE on any table (RLS does not govern TRUNCATE)', async () => {
    const tables = await publicTables();
    expect(tables.length).toBeGreaterThanOrEqual(8);
    await asApp(APP, { orgId: orgB.orgId, userId: orgB.owner.userId }, async (c) => {
      for (const table of tables) {
        const result = await attempt(c, `TRUNCATE "${table}"`);
        expect(result, table).toEqual({ ok: false, code: INSUFFICIENT_PRIVILEGE });
      }
    });
  });

  it('shows the app role nothing in any table when no context is set', async () => {
    const tables = await publicTables();
    await asApp(APP, {}, async (c) => {
      for (const table of tables) {
        const res = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
        expect(res.rows[0]?.n, table).toBe('0');
      }
    });
  });
});

describe.each(Object.keys(TENANT_FIXTURES))('cross-tenant: %s', (table) => {
  const fixture = TENANT_FIXTURES[table];
  if (fixture === undefined) throw new Error(`no fixture for ${table}`);
  let rowA: Record<string, unknown> & { id: string };
  let snapshot: unknown;
  let appCanInsert = false;
  let spareForB: string;

  beforeAll(async () => {
    const spareForA = await seedUser(OWNER);
    spareForB = (await seedUser(OWNER)).userId;
    rowA = await insertAsOwner(
      table,
      fixture({ orgId: orgA.orgId, spareUserId: spareForA.userId }),
    );
    snapshot = await readAsOwner(table, rowA.id);
    appCanInsert = await withPgClient(OWNER, async (c) => {
      const res = await c.query<{ ok: boolean }>(
        `SELECT has_table_privilege('ig_app', $1, 'INSERT') AS ok`,
        [table],
      );
      return res.rows[0]?.ok === true;
    });
  });

  afterAll(async () => {
    // Whatever org B attempted, org A's row is exactly as it was.
    expect(await readAsOwner(table, rowA.id)).toEqual(snapshot);
  });

  const asB = <T>(fn: (c: pg.Client) => Promise<T>) =>
    asApp(APP, { orgId: orgB.orgId, userId: orgB.owner.userId }, fn);

  it('SELECT without an org filter returns only org B rows', async () => {
    await asB(async (c) => {
      const all = await attempt(c, `SELECT * FROM "${table}"`);
      if (!all.ok) throw new Error(`select failed: ${all.code}`);
      for (const row of all.rows) expect(row.org_id).toBe(orgB.orgId);
      expect(all.rows.map((r) => r.id)).not.toContain(rowA.id);
    });
  });

  it('SELECT by id or by org A id finds nothing', async () => {
    await asB(async (c) => {
      expect(await attempt(c, `SELECT * FROM "${table}" WHERE id = $1`, [rowA.id])).toMatchObject({
        ok: true,
        rowCount: 0,
      });
      expect(
        await attempt(c, `SELECT * FROM "${table}" WHERE org_id = $1`, [orgA.orgId]),
      ).toMatchObject({ ok: true, rowCount: 0 });
    });
  });

  it('UPDATE cannot touch or steal the org A row', async () => {
    await asB(async (c) => {
      expectNoEffect(
        await attempt(c, `UPDATE "${table}" SET org_id = org_id WHERE id = $1`, [rowA.id]),
      );
      expectNoEffect(
        await attempt(c, `UPDATE "${table}" SET org_id = $2 WHERE id = $1`, [rowA.id, orgB.orgId]),
      );
      // The forgotten-filter case: may update org B rows, never org A's (checked in afterAll).
      await attempt(c, `UPDATE "${table}" SET org_id = org_id`);
    });
  });

  it('UPDATE cannot move an org B row into org A', async () => {
    await asB(async (c) => {
      const moved = await attempt(c, `UPDATE "${table}" SET org_id = $1`, [orgA.orgId]);
      if (moved.ok) expect(moved.rowCount).toBe(0);
      else expect(moved.code).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it('DELETE cannot remove the org A row, with or without a filter', async () => {
    await asB(async (c) => {
      expectNoEffect(await attempt(c, `DELETE FROM "${table}" WHERE id = $1`, [rowA.id]));
      await attempt(c, `DELETE FROM "${table}"`);
      const stillThere = await withPgClient(OWNER, (o) =>
        o.query(`SELECT 1 FROM "${table}" WHERE id = $1`, [rowA.id]),
      );
      expect(stillThere.rowCount).toBe(1);
    });
  });

  it('INSERT into org A is rejected; INSERT into org B works', async () => {
    const spare = await seedUser(OWNER);
    await asB(async (c) => {
      const intoA = insertStatement(
        table,
        fixture({ orgId: orgA.orgId, spareUserId: spare.userId }),
      );
      expect(await attempt(c, intoA.text, intoA.values)).toEqual({
        ok: false,
        code: INSUFFICIENT_PRIVILEGE,
      });
      if (appCanInsert) {
        const intoB = insertStatement(
          table,
          fixture({ orgId: orgB.orgId, spareUserId: spareForB }),
        );
        expect(await attempt(c, intoB.text, intoB.values)).toMatchObject({ ok: true, rowCount: 1 });
      }
    });
  });
});

describe('cross-tenant: organizations', () => {
  let bothOrgsUser: string;

  beforeAll(async () => {
    bothOrgsUser = (await seedUser(OWNER)).userId;
    await seedMembership(OWNER, orgA.orgId, bothOrgsUser, 'viewer');
    await seedMembership(OWNER, orgB.orgId, bothOrgsUser, 'viewer');
  });

  it('org B sees only itself, and cannot update, delete or create orgs', async () => {
    await asApp(APP, { orgId: orgB.orgId, userId: orgB.owner.userId }, async (c) => {
      const all = await attempt(c, 'SELECT id FROM organizations');
      expect(all).toMatchObject({ ok: true, rows: [{ id: orgB.orgId }] });
      expectNoEffect(
        await attempt(c, `UPDATE organizations SET name = 'taken' WHERE id = $1`, [orgA.orgId]),
      );
      expect(await attempt(c, 'DELETE FROM organizations')).toEqual({
        ok: false,
        code: INSUFFICIENT_PRIVILEGE,
      });
      expect(
        await attempt(c, `INSERT INTO organizations (name, slug) VALUES ('x', 'x-probe')`),
      ).toEqual({ ok: false, code: INSUFFICIENT_PRIVILEGE });
    });
    const name = await withPgClient(OWNER, (c) =>
      c.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [orgA.orgId]),
    );
    expect(name.rows[0]?.name).toBe('Org A');
  });

  it('a user without an org context sees exactly the orgs they belong to', async () => {
    await asApp(APP, { userId: bothOrgsUser }, async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM organizations ORDER BY id');
      expect(res.rows.map((r) => r.id).sort()).toEqual([orgA.orgId, orgB.orgId].sort());
    });
    await asApp(APP, { userId: orgB.owner.userId }, async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM organizations');
      expect(res.rows).toEqual([{ id: orgB.orgId }]);
    });
  });

  it('memberships: a user reads their own rows in other orgs but not other members there', async () => {
    await asApp(APP, { orgId: orgB.orgId, userId: bothOrgsUser }, async (c) => {
      const inA = await c.query<{ user_id: string }>(
        'SELECT user_id FROM memberships WHERE org_id = $1',
        [orgA.orgId],
      );
      expect(inA.rows).toEqual([{ user_id: bothOrgsUser }]);
      expectNoEffect(
        await attempt(c, `UPDATE memberships SET role = 'owner' WHERE org_id = $1`, [orgA.orgId]),
      );
    });
  });
});

describe('cross-user: identity tables', () => {
  let sessionA: string;

  beforeAll(async () => {
    await withPgClient(OWNER, async (c) => {
      const s = await c.query<{ id: string }>(
        `INSERT INTO sessions (user_id, token_hash, active_org_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
        [orgA.owner.userId, randomBytes(32), orgA.orgId],
      );
      sessionA = s.rows[0]?.id ?? '';
      await c.query(
        `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
         VALUES ($1, 'password_reset', $2, now() + interval '1 hour')`,
        [orgA.owner.userId, randomBytes(32)],
      );
    });
  });

  const asB = <T>(fn: (c: pg.Client) => Promise<T>) =>
    asApp(APP, { orgId: orgB.orgId, userId: orgB.owner.userId }, fn);

  it('users: sees self and co-members only; cannot rename others', async () => {
    await asB(async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM users');
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(orgB.owner.userId);
      expect(ids).not.toContain(orgA.owner.userId);
      expectNoEffect(
        await attempt(c, `UPDATE users SET name = 'x' WHERE id = $1`, [orgA.owner.userId]),
      );
      expectNoEffect(
        await attempt(c, `UPDATE users SET email = 'x@example.test' WHERE id = $1`, [
          orgB.owner.userId,
        ]),
      );
    });
  });

  it('user_credentials: only the current user row, never anyone else', async () => {
    await asB(async (c) => {
      const res = await c.query<{ user_id: string }>('SELECT user_id FROM user_credentials');
      expect(res.rows).toEqual([{ user_id: orgB.owner.userId }]);
      expectNoEffect(
        await attempt(c, `UPDATE user_credentials SET password_hash = 'x' WHERE user_id = $1`, [
          orgA.owner.userId,
        ]),
      );
    });
  });

  it('sessions: cannot read, hijack, delete or create sessions of another user', async () => {
    await asB(async (c) => {
      const res = await c.query<{ user_id: string }>('SELECT user_id FROM sessions');
      for (const row of res.rows) expect(row.user_id).toBe(orgB.owner.userId);
      expectNoEffect(
        await attempt(
          c,
          "UPDATE sessions SET expires_at = now() + interval '1 year' WHERE id = $1",
          [sessionA],
        ),
      );
      expectNoEffect(await attempt(c, 'DELETE FROM sessions WHERE id = $1', [sessionA]));
      expect(
        await attempt(
          c,
          `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now())`,
          [orgA.owner.userId, randomBytes(32)],
        ),
      ).toEqual({ ok: false, code: INSUFFICIENT_PRIVILEGE });
    });
  });

  it('auth_tokens: cannot read or mint tokens for another user', async () => {
    await asB(async (c) => {
      const res = await c.query('SELECT 1 FROM auth_tokens WHERE user_id = $1', [
        orgA.owner.userId,
      ]);
      expect(res.rowCount).toBe(0);
      expect(
        await attempt(
          c,
          `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
           VALUES ($1, 'magic_link', $2, now() + interval '1 hour')`,
          [orgA.owner.userId, randomBytes(32)],
        ),
      ).toEqual({ ok: false, code: INSUFFICIENT_PRIVILEGE });
    });
  });
});

describe('withOrg (the application entry point)', () => {
  const db = createDatabase(APP, { applicationName: 'ig-rls-test', maxConnections: 1 });
  afterAll(() => db.close());

  it.each([
    ['memberships', memberships],
    ['invites', invites],
    ['audit_log', auditLog],
  ] as const)(
    'a query on %s without an org filter returns only the current org',
    async (_, table) => {
      const rows = await db.withOrg(orgB.orgId, (tx) => tx.select().from(table), {
        userId: orgB.owner.userId,
      });
      for (const row of rows) expect(row.orgId).toBe(orgB.orgId);
    },
  );

  it('cannot load another org even by id', async () => {
    expect(await db.withOrg(orgB.orgId, (tx) => getOrganization(tx, orgA.orgId))).toBeNull();
    expect(await db.withOrg(orgA.orgId, (tx) => getOrganization(tx, orgA.orgId))).toMatchObject({
      id: orgA.orgId,
    });
  });

  it('does not leak context to the next transaction on the same pooled connection', async () => {
    const context = (tx: Tx) =>
      tx.execute<{ org: string | null; usr: string | null }>(
        sql`SELECT app_org_id()::text AS org, app_user_id()::text AS usr`,
      );
    const first = await db.withOrg(orgA.orgId, context, { userId: orgA.owner.userId });
    expect(first.rows[0]).toEqual({ org: orgA.orgId, usr: orgA.owner.userId });

    await expect(db.withOrg(orgA.orgId, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    const second = await db.withUser(orgB.owner.userId, context);
    expect(second.rows[0]).toEqual({ org: null, usr: orgB.owner.userId });
  });

  it('rejects a malformed org id before touching the database', async () => {
    await expect(db.withOrg("x' OR true --", () => Promise.resolve(1))).rejects.toThrow();
  });
});
