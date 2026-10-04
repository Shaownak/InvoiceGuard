import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from './client';
import { recordAudit } from './repos/audit';
import { auditLog } from './schema';
import { asApp, attempt, seedTenant, withPgClient, type SeededTenant } from './testing';

// FR-ADM-1: the audit log is append-only, enforced by the database (ADR-0016). The app role
// lacks UPDATE/DELETE/TRUNCATE privileges, and a trigger refuses them even for the owner.

const infra = inject('testInfra');
const OWNER = infra.postgres.ownerUrl;
const APPEND_ONLY = 'IG001';
const INSUFFICIENT_PRIVILEGE = '42501';

let tenant: SeededTenant;
let other: SeededTenant;
let entryId: string;
const db = createDatabase(infra.postgres.appUrl, { applicationName: 'ig-audit-test' });

beforeAll(async () => {
  [tenant, other] = await Promise.all([seedTenant(OWNER), seedTenant(OWNER)]);
  await db.withOrg(
    tenant.orgId,
    (tx) =>
      recordAudit(tx, {
        orgId: tenant.orgId,
        actorId: tenant.owner.userId,
        action: 'member.role_changed',
        entityType: 'membership',
        entityId: 'm-1',
        before: { role: 'viewer' },
        after: { role: 'admin' },
        ip: '203.0.113.7',
        userAgent: 'vitest',
      }),
    { userId: tenant.owner.userId },
  );
  const rows = await db.withOrg(tenant.orgId, (tx) => tx.select().from(auditLog));
  entryId = rows[0]?.id ?? '';
});

afterAll(() => db.close());

describe('audit_log', () => {
  it('records an entry the org can read back', async () => {
    const rows = await db.withOrg(tenant.orgId, (tx) => tx.select().from(auditLog));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: tenant.orgId,
      actorId: tenant.owner.userId,
      action: 'member.role_changed',
      before: { role: 'viewer' },
      after: { role: 'admin' },
      ip: '203.0.113.7',
    });
  });

  it('refuses UPDATE, DELETE and TRUNCATE from the app role (no privilege)', async () => {
    await asApp(infra.postgres.appUrl, { orgId: tenant.orgId }, async (c) => {
      expect(
        await attempt(c, `UPDATE audit_log SET action = 'x' WHERE id = $1`, [entryId]),
      ).toEqual({ ok: false, code: INSUFFICIENT_PRIVILEGE });
      expect(await attempt(c, 'DELETE FROM audit_log WHERE id = $1', [entryId])).toEqual({
        ok: false,
        code: INSUFFICIENT_PRIVILEGE,
      });
      expect(await attempt(c, 'TRUNCATE audit_log')).toEqual({
        ok: false,
        code: INSUFFICIENT_PRIVILEGE,
      });
    });
  });

  it('refuses UPDATE, DELETE and TRUNCATE even from the owner role (trigger)', async () => {
    await withPgClient(OWNER, async (c) => {
      await c.query('BEGIN');
      try {
        expect(
          await attempt(c, `UPDATE audit_log SET action = 'x' WHERE id = $1`, [entryId]),
        ).toEqual({ ok: false, code: APPEND_ONLY });
        expect(await attempt(c, 'DELETE FROM audit_log WHERE id = $1', [entryId])).toEqual({
          ok: false,
          code: APPEND_ONLY,
        });
        expect(await attempt(c, 'TRUNCATE audit_log')).toEqual({ ok: false, code: APPEND_ONLY });
      } finally {
        await c.query('ROLLBACK');
      }
    });
    const row = await withPgClient(OWNER, (c) =>
      c.query<{ action: string }>('SELECT action FROM audit_log WHERE id = $1', [entryId]),
    );
    expect(row.rows[0]?.action).toBe('member.role_changed');
  });

  it('names the operation in the trigger error', async () => {
    await withPgClient(OWNER, async (c) => {
      await expect(c.query('DELETE FROM audit_log WHERE id = $1', [entryId])).rejects.toThrow(
        'audit_log is append-only: DELETE is not allowed',
      );
    });
  });

  it('cannot be written into another org', async () => {
    await expect(
      db.withOrg(tenant.orgId, (tx) =>
        recordAudit(tx, {
          orgId: other.orgId,
          actorId: null,
          action: 'org.created',
          entityType: 'organization',
          entityId: null,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: INSUFFICIENT_PRIVILEGE } });
  });

  it('rolls back with the change it describes', async () => {
    await expect(
      db.withOrg(tenant.orgId, async (tx) => {
        await recordAudit(tx, {
          orgId: tenant.orgId,
          actorId: null,
          action: 'invite.revoked',
          entityType: 'invite',
          entityId: null,
        });
        throw new Error('change failed');
      }),
    ).rejects.toThrow('change failed');
    const rows = await db.withOrg(tenant.orgId, (tx) => tx.select().from(auditLog));
    expect(rows.map((r) => r.action)).not.toContain('invite.revoked');
  });
});
