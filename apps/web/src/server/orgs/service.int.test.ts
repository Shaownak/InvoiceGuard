import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { uniqueEmail, withPgClient } from '@invoiceguard/db/testing';
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
} from '@invoiceguard/shared/errors';
import type { Role } from '@invoiceguard/shared/permissions';
import type { OrgSessionContext, SessionContext } from '../services';
import { META, auditActions, createTestServices, type TestServices } from '../testing';

const infra = inject('testInfra');
const OWNER = infra.postgres.ownerUrl;
const PASSWORD = 'correct horse battery staple';

let t: TestServices;
beforeAll(() => {
  t = createTestServices(infra);
});
afterAll(() => t.close());

async function ctx(token: string): Promise<SessionContext> {
  const session = await t.services.auth.authenticate(token);
  if (session === null) throw new Error('session not found');
  return session;
}

async function orgCtx(token: string): Promise<OrgSessionContext> {
  const session = await ctx(token);
  if (session.org === null) throw new Error('session has no org');
  return { ...session, org: session.org };
}

async function owner(orgName = 'Acme') {
  const email = uniqueEmail('owner');
  await t.services.auth.signup({ name: 'Olive Owner', email, password: PASSWORD, orgName }, META);
  const issued = await t.services.auth.verifyEmail(
    t.mailer.tokenFrom(email, '/verify-email'),
    META,
  );
  return { email, token: issued.token, orgId: issued.orgId ?? '' };
}

/** Invites a new person with `role` and has them sign up from the link. */
async function member(inviterToken: string, role: Role) {
  const email = uniqueEmail(role);
  await t.services.orgs.invite(await orgCtx(inviterToken), { email, role }, META);
  const issued = await t.services.orgs.signupFromInvite(
    { token: t.mailer.tokenFrom(email, '/invite'), name: `M ${role}`, password: PASSWORD },
    META,
  );
  const session = await orgCtx(issued.token);
  const members = await t.services.orgs.listMembers(session);
  const membershipId = members.find((m) => m.email === email)?.membershipId ?? '';
  return { email, token: issued.token, membershipId };
}

describe('organizations', () => {
  it('creates a second org, switches between them, and rotates the session token', async () => {
    const o = await owner('First');
    const created = await t.services.orgs.createOrganization(await ctx(o.token), 'Second', META);
    expect(created.orgId).not.toBe(o.orgId);
    expect(await t.services.auth.authenticate(o.token)).toBeNull();

    const orgs = await t.services.orgs.listMyOrganizations((await ctx(created.token)).user.id);
    expect(orgs.map((org) => [org.name, org.role])).toEqual([
      ['First', 'owner'],
      ['Second', 'owner'],
    ]);

    const back = await t.services.orgs.switchOrganization(await ctx(created.token), o.orgId, META);
    expect((await ctx(back.token)).org?.id).toBe(o.orgId);
    expect(await t.services.auth.authenticate(created.token)).toBeNull();
    expect(await auditActions(OWNER, o.orgId)).toContain('session.org_switched');
  });

  it('refuses to switch into an org the user does not belong to', async () => {
    const a = await owner('A');
    const b = await owner('B');
    await expect(
      t.services.orgs.switchOrganization(await ctx(a.token), b.orgId, META),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await ctx(a.token)).org?.id).toBe(a.orgId);
  });

  it('lists only the active org members', async () => {
    const a = await owner('A');
    const b = await owner('B');
    const members = await t.services.orgs.listMembers(await orgCtx(a.token));
    expect(members.map((m) => m.email)).toEqual([a.email]);
    expect(members.map((m) => m.email)).not.toContain(b.email);
  });
});

describe('invites', () => {
  it('new user: signs up from the link verified, with the invited role, signed in to the org', async () => {
    const o = await owner();
    const m = await member(o.token, 'reviewer');
    const session = await orgCtx(m.token);
    expect(session.org).toEqual({ id: o.orgId, role: 'reviewer' });
    expect(await auditActions(OWNER, o.orgId)).toEqual(
      expect.arrayContaining(['member.invited', 'member.joined']),
    );
    const verified = await withPgClient(OWNER, (c) =>
      c.query('SELECT 1 FROM users WHERE email = $1 AND email_verified_at IS NOT NULL', [m.email]),
    );
    expect(verified.rowCount).toBe(1);
  });

  it('previews the invite, and a used link is gone', async () => {
    const o = await owner('Preview Co');
    const email = uniqueEmail('p');
    await t.services.orgs.invite(await orgCtx(o.token), { email, role: 'viewer' }, META);
    const token = t.mailer.tokenFrom(email, '/invite');
    expect(await t.services.orgs.previewInvite(token)).toEqual({
      orgName: 'Preview Co',
      email,
      role: 'viewer',
      status: 'open',
    });
    await t.services.orgs.signupFromInvite({ token, name: 'P', password: PASSWORD }, META);
    expect((await t.services.orgs.previewInvite(token)).status).toBe('accepted');
    await expect(
      t.services.orgs.signupFromInvite({ token, name: 'P2', password: PASSWORD }, META),
    ).rejects.toBeInstanceOf(GoneError);
  });

  it('expires after 7 days', async () => {
    const o = await owner();
    const email = uniqueEmail('late');
    const invite = await t.services.orgs.invite(
      await orgCtx(o.token),
      { email, role: 'viewer' },
      META,
    );
    const days = (invite.expiresAt.getTime() - invite.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
    await withPgClient(OWNER, (c) =>
      c.query(`UPDATE invites SET expires_at = now() - interval '1 second' WHERE id = $1`, [
        invite.id,
      ]),
    );
    const token = t.mailer.tokenFrom(email, '/invite');
    expect((await t.services.orgs.previewInvite(token)).status).toBe('expired');
    await expect(
      t.services.orgs.signupFromInvite({ token, name: 'L', password: PASSWORD }, META),
    ).rejects.toBeInstanceOf(GoneError);
  });

  it('re-inviting replaces the previous link; revoking kills it', async () => {
    const o = await owner();
    const session = await orgCtx(o.token);
    const email = uniqueEmail('again');
    await t.services.orgs.invite(session, { email, role: 'viewer' }, META);
    const first = t.mailer.tokenFrom(email, '/invite');
    const second = await t.services.orgs.invite(session, { email, role: 'approver' }, META);
    expect((await t.services.orgs.previewInvite(first)).status).toBe('revoked');
    expect(await t.services.orgs.listInvites(session)).toHaveLength(1);

    await t.services.orgs.revokeInvite(session, second.id, META);
    expect((await t.services.orgs.previewInvite(t.mailer.tokenFrom(email, '/invite'))).status).toBe(
      'revoked',
    );
    expect(await t.services.orgs.listInvites(session)).toEqual([]);
    await expect(t.services.orgs.revokeInvite(session, second.id, META)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('existing user: accepts only when signed in as the invited address', async () => {
    const a = await owner('Inviting');
    const b = await owner('Other');
    const stranger = await owner('Stranger');
    await t.services.orgs.invite(await orgCtx(a.token), { email: b.email, role: 'approver' }, META);
    const token = t.mailer.tokenFrom(b.email, '/invite');

    await expect(
      t.services.orgs.acceptInvite(await ctx(stranger.token), token, META),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      t.services.orgs.signupFromInvite({ token, name: 'Dup', password: PASSWORD }, META),
    ).rejects.toBeInstanceOf(ConflictError);

    const joined = await t.services.orgs.acceptInvite(await ctx(b.token), token, META);
    expect((await ctx(joined.token)).org).toEqual({ id: a.orgId, role: 'approver' });
  });

  it('refuses to invite someone who is already a member', async () => {
    const o = await owner();
    await expect(
      t.services.orgs.invite(
        await orgCtx(o.token),
        { email: o.email.toUpperCase(), role: 'viewer' },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('member management', () => {
  it('admins manage non-owners but cannot grant, change or remove the owner role', async () => {
    const o = await owner();
    const admin = await member(o.token, 'admin');
    const viewer = await member(o.token, 'viewer');
    const adminSession = await orgCtx(admin.token);

    await t.services.orgs.changeRole(adminSession, viewer.membershipId, 'reviewer', META);
    await expect(
      t.services.orgs.changeRole(adminSession, viewer.membershipId, 'owner', META),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      t.services.orgs.invite(adminSession, { email: uniqueEmail('x'), role: 'owner' }, META),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const ownerMembership = (await t.services.orgs.listMembers(adminSession)).find(
      (m) => m.role === 'owner',
    );
    await expect(
      t.services.orgs.removeMember(adminSession, ownerMembership?.membershipId ?? '', META),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditActions(OWNER, o.orgId)).toContain('member.role_changed');
  });

  it('keeps at least one owner', async () => {
    const o = await owner();
    const session = await orgCtx(o.token);
    const self = (await t.services.orgs.listMembers(session))[0];
    await expect(
      t.services.orgs.changeRole(session, self?.membershipId ?? '', 'admin', META),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      t.services.orgs.removeMember(session, self?.membershipId ?? '', META),
    ).rejects.toBeInstanceOf(ConflictError);

    const second = await member(o.token, 'owner');
    await t.services.orgs.changeRole(session, second.membershipId, 'admin', META);
    await t.services.orgs.changeRole(session, second.membershipId, 'owner', META);
    await t.services.orgs.changeRole(session, self?.membershipId ?? '', 'admin', META);
  });

  it('removing a member ends their access to the org at once', async () => {
    const o = await owner();
    const m = await member(o.token, 'reviewer');
    await t.services.orgs.removeMember(await orgCtx(o.token), m.membershipId, META);
    const after = await ctx(m.token);
    expect(after.org).toBeNull();
    expect(await auditActions(OWNER, o.orgId)).toContain('member.removed');
  });

  it('cannot touch a membership of another org', async () => {
    const a = await owner('A');
    const b = await owner('B');
    const bMembers = await t.services.orgs.listMembers(await orgCtx(b.token));
    await expect(
      t.services.orgs.changeRole(
        await orgCtx(a.token),
        bMembers[0]?.membershipId ?? '',
        'viewer',
        META,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      t.services.orgs.removeMember(await orgCtx(a.token), bMembers[0]?.membershipId ?? '', META),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each(['approver', 'reviewer', 'viewer'] as const)(
    '%s cannot invite, change roles, or remove members',
    async (role) => {
      const o = await owner();
      const m = await member(o.token, role);
      const other = await member(o.token, 'viewer');
      const session = await orgCtx(m.token);
      await expect(
        t.services.orgs.invite(session, { email: uniqueEmail('x'), role: 'viewer' }, META),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        t.services.orgs.changeRole(session, other.membershipId, 'admin', META),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        t.services.orgs.removeMember(session, other.membershipId, META),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(t.services.orgs.listInvites(session)).rejects.toBeInstanceOf(ForbiddenError);
    },
  );
});
