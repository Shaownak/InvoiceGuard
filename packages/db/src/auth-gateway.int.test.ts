import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { EmailTakenError } from './auth-gateway';
import { createDatabase } from './client';
import { getMembership } from './repos/memberships';
import { createOrganization } from './repos/organizations';
import {
  asApp,
  attempt,
  seedMembership,
  seedTenant,
  seedUser,
  uniqueEmail,
  withPgClient,
  type SeededTenant,
} from './testing';

// The SECURITY DEFINER functions are the only paths that bypass row-level security, so each
// is tested for doing exactly its one job.

const infra = inject('testInfra');
const OWNER = infra.postgres.ownerUrl;
const db = createDatabase(infra.postgres.appUrl, { applicationName: 'ig-gateway-test' });
afterAll(() => db.close());

async function ownerQuery<R extends object>(text: string, values: unknown[] = []): Promise<R[]> {
  return withPgClient(OWNER, async (c) => (await c.query<R>(text, values)).rows);
}

describe('registerUser / findUserByEmail', () => {
  it('creates an unverified user with credentials, found case-insensitively', async () => {
    const email = uniqueEmail('reg');
    const id = await db.auth.registerUser({ email, name: 'Reg', passwordHash: '$argon2id$x' });
    const found = await db.auth.findUserByEmail(email.toUpperCase());
    expect(found).toEqual({
      id,
      email,
      name: 'Reg',
      email_verified_at: null,
      password_hash: '$argon2id$x',
    });
  });

  it('rejects a duplicate email regardless of case', async () => {
    const email = uniqueEmail('dup');
    await db.auth.registerUser({ email, name: 'A', passwordHash: 'h' });
    await expect(
      db.auth.registerUser({ email: email.toUpperCase(), name: 'B', passwordHash: 'h' }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('returns null for an unknown email', async () => {
    expect(await db.auth.findUserByEmail(uniqueEmail('nobody'))).toBeNull();
  });
});

describe('lookupSession', () => {
  let tenant: SeededTenant;
  beforeAll(async () => {
    tenant = await seedTenant(OWNER);
  });

  async function insertSession(hash: Buffer, orgId: string | null, expiresIn: string) {
    await ownerQuery(
      `INSERT INTO sessions (user_id, token_hash, active_org_id, expires_at)
       VALUES ($1, $2, $3, now() + $4::interval)`,
      [tenant.owner.userId, hash, orgId, expiresIn],
    );
  }

  it('returns a live session with the role in its active org', async () => {
    const hash = randomBytes(32);
    await insertSession(hash, tenant.orgId, '1 hour');
    expect(await db.auth.lookupSession(hash)).toMatchObject({
      user_id: tenant.owner.userId,
      active_org_id: tenant.orgId,
      role: 'owner',
      email: tenant.owner.email,
    });
  });

  it('returns no role when the session has no active org', async () => {
    const hash = randomBytes(32);
    await insertSession(hash, null, '1 hour');
    expect(await db.auth.lookupSession(hash)).toMatchObject({ active_org_id: null, role: null });
  });

  it('ignores expired sessions and unknown tokens', async () => {
    const hash = randomBytes(32);
    await insertSession(hash, tenant.orgId, '-1 second');
    expect(await db.auth.lookupSession(hash)).toBeNull();
    expect(await db.auth.lookupSession(randomBytes(32))).toBeNull();
  });

  it('refuses an active org the user does not belong to (composite foreign key)', async () => {
    const stranger = await seedTenant(OWNER);
    await expect(insertSession(randomBytes(32), stranger.orgId, '1 hour')).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('clears the active org when the membership is removed', async () => {
    const member = await seedUser(OWNER);
    const membershipId = await seedMembership(OWNER, tenant.orgId, member.userId, 'viewer');
    const hash = randomBytes(32);
    await ownerQuery(
      `INSERT INTO sessions (user_id, token_hash, active_org_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [member.userId, hash, tenant.orgId],
    );
    await ownerQuery('DELETE FROM memberships WHERE id = $1', [membershipId]);
    expect(await db.auth.lookupSession(hash)).toMatchObject({ active_org_id: null, role: null });
  });
});

describe('consumeToken', () => {
  async function issue(userId: string, purpose: string, expiresIn = '1 hour'): Promise<Buffer> {
    const hash = randomBytes(32);
    await ownerQuery(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + $4::interval)`,
      [userId, purpose, hash, expiresIn],
    );
    return hash;
  }

  it('is single-use and marks the email verified', async () => {
    const user = await seedUser(OWNER, { verified: false });
    const hash = await issue(user.userId, 'verify_email');
    expect(await db.auth.consumeToken(hash, 'verify_email')).toBe(user.userId);
    expect(await db.auth.consumeToken(hash, 'verify_email')).toBeNull();
    const [row] = await ownerQuery<{ verified: boolean }>(
      'SELECT email_verified_at IS NOT NULL AS verified FROM users WHERE id = $1',
      [user.userId],
    );
    expect(row?.verified).toBe(true);
  });

  it('rejects an expired token and a token of another purpose', async () => {
    const user = await seedUser(OWNER);
    expect(
      await db.auth.consumeToken(await issue(user.userId, 'magic_link', '-1 second'), 'magic_link'),
    ).toBeNull();
    const reset = await issue(user.userId, 'password_reset');
    expect(await db.auth.consumeToken(reset, 'magic_link')).toBeNull();
    expect(await db.auth.consumeToken(reset, 'password_reset')).toBe(user.userId);
  });

  it('retires the other open tokens of the same purpose', async () => {
    const user = await seedUser(OWNER);
    const first = await issue(user.userId, 'password_reset');
    const second = await issue(user.userId, 'password_reset');
    const magic = await issue(user.userId, 'magic_link');
    expect(await db.auth.consumeToken(second, 'password_reset')).toBe(user.userId);
    expect(await db.auth.consumeToken(first, 'password_reset')).toBeNull();
    expect(await db.auth.consumeToken(magic, 'magic_link')).toBe(user.userId);
  });
});

describe('lookupInvite', () => {
  it('returns the invite with its org name, or null', async () => {
    const tenant = await seedTenant(OWNER, 'Invite Org');
    const hash = randomBytes(32);
    const email = uniqueEmail('inv');
    await ownerQuery(
      `INSERT INTO invites (org_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, 'reviewer', $3, now() + interval '7 days')`,
      [tenant.orgId, email, hash],
    );
    expect(await db.auth.lookupInvite(hash)).toMatchObject({
      org_id: tenant.orgId,
      org_name: 'Invite Org',
      email,
      role: 'reviewer',
      accepted_at: null,
      revoked_at: null,
    });
    expect(await db.auth.lookupInvite(randomBytes(32))).toBeNull();
  });
});

describe('create_organization', () => {
  it('creates the org and makes the current user its owner', async () => {
    const user = await seedUser(OWNER);
    const orgId = await db.withUser(user.userId, (tx) => createOrganization(tx, 'Ácme Corp, Ltd.'));
    const membership = await db.withOrg(orgId, (tx) => getMembership(tx, orgId, user.userId));
    expect(membership?.role).toBe('owner');
    const [org] = await ownerQuery<{ slug: string }>(
      'SELECT slug FROM organizations WHERE id = $1',
      [orgId],
    );
    expect(org?.slug).toMatch(/^acme-corp-ltd-[0-9a-f]{6}$/);
  });

  it('refuses to run without a user context', async () => {
    await asApp(infra.postgres.appUrl, {}, async (c) => {
      expect(await attempt(c, `SELECT create_organization('X', 'x')`)).toEqual({
        ok: false,
        code: '42501',
      });
      expect(await attempt(c, `SELECT create_organization('X', 'Bad Slug!')`)).toEqual({
        ok: false,
        code: '42501',
      });
    });
    const user = await seedUser(OWNER);
    await asApp(infra.postgres.appUrl, { userId: user.userId }, async (c) => {
      expect(await attempt(c, `SELECT create_organization('X', 'Bad Slug!')`)).toEqual({
        ok: false,
        code: '23514',
      });
    });
  });

  it('is not executable by roles other than the app role', async () => {
    const [row] = await ownerQuery<{ public_can: boolean }>(
      `SELECT has_function_privilege('public', 'create_organization(text, text)', 'EXECUTE') AS public_can`,
    );
    expect(row?.public_can).toBe(false);
  });
});
