import {
  EmailTakenError,
  addMembership,
  createInvite,
  createOrganization,
  deleteMembership,
  getMembership,
  getMembershipById,
  getOrganization,
  listMembers,
  listOpenInvites,
  listUserOrganizations,
  lockOrgAndCountOwners,
  markEmailVerified,
  markInviteAccepted,
  recordAudit,
  revokeInvite,
  updateMembershipRole,
  type InviteRecord,
  type MemberRow,
  type OpenInvite,
  type OrganizationSummary,
  type Tx,
} from '@invoiceguard/db';
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
} from '@invoiceguard/shared/errors';
import { authorize, authorizeMemberChange, type Role } from '@invoiceguard/shared/permissions';
import type { AuthService } from '../auth/service';
import { TTL_MS } from '../auth/service';
import { hashPassword } from '../auth/password';
import { generateToken, hashToken, isWellFormedToken } from '../auth/tokens';
import * as emails from '../email/templates';
import type {
  IssuedSession,
  OrgSessionContext,
  RequestMeta,
  ServiceDeps,
  SessionContext,
} from '../services';

export type InviteStatus = 'open' | 'expired' | 'accepted' | 'revoked';

export interface InvitePreview {
  orgName: string;
  email: string;
  role: Role;
  status: InviteStatus;
}

function inviteStatus(invite: InviteRecord, now: Date): InviteStatus {
  if (invite.accepted_at !== null) return 'accepted';
  if (invite.revoked_at !== null) return 'revoked';
  if (invite.expires_at <= now) return 'expired';
  return 'open';
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type OrgService = ReturnType<typeof createOrgService>;

export function createOrgService(deps: ServiceDeps, auth: AuthService) {
  const { db, mailer, secret, appUrl } = deps;

  /** The one place memberships are created from an invite (existing and new users). */
  async function joinFromInvite(tx: Tx, invite: InviteRecord, userId: string, meta: RequestMeta) {
    if (!(await markInviteAccepted(tx, invite.invite_id, userId))) throw new GoneError();
    const { membership, created } = await addMembership(tx, {
      orgId: invite.org_id,
      userId,
      role: invite.role,
    });
    if (created) {
      await recordAudit(tx, {
        orgId: invite.org_id,
        actorId: userId,
        action: 'member.joined',
        entityType: 'membership',
        entityId: membership.id,
        after: { userId, role: invite.role, inviteId: invite.invite_id },
        ...meta,
      });
    }
  }

  async function openInvite(token: string): Promise<InviteRecord> {
    if (!isWellFormedToken(token))
      throw new GoneError('This invitation is invalid or has expired.');
    const invite = await db.auth.lookupInvite(hashToken(secret, token));
    if (invite === null || inviteStatus(invite, new Date()) !== 'open') {
      throw new GoneError('This invitation is invalid or has expired.');
    }
    return invite;
  }

  return {
    async listMyOrganizations(userId: string): Promise<OrganizationSummary[]> {
      return db.withUser(userId, (tx) => listUserOrganizations(tx, userId));
    },

    async getActiveOrganization(session: OrgSessionContext) {
      return db.withOrg(session.org.id, (tx) => getOrganization(tx, session.org.id), {
        userId: session.user.id,
      });
    },

    /** FR-ORG-1: any signed-in user may create an organization; they become its owner. */
    async createOrganization(
      session: SessionContext,
      name: string,
      meta: RequestMeta,
    ): Promise<IssuedSession> {
      const userId = session.user.id;
      const orgId = await db.withUser(userId, (tx) => createOrganization(tx, name));
      return db.withOrg(
        orgId,
        async (tx) => {
          await recordAudit(tx, {
            orgId,
            actorId: userId,
            action: 'org.created',
            entityType: 'organization',
            entityId: orgId,
            after: { name },
            ...meta,
          });
          return auth.rotateInto(tx, session, orgId, meta, false);
        },
        { userId },
      );
    },

    /** FR-ORG-1: switch the session to another org the user belongs to. */
    async switchOrganization(
      session: SessionContext,
      orgId: string,
      meta: RequestMeta,
    ): Promise<IssuedSession> {
      const userId = session.user.id;
      const isMember = await db.withUser(
        userId,
        async (tx) => (await getMembership(tx, orgId, userId)) !== null,
      );
      if (!isMember) throw new NotFoundError('Organization not found');
      return db.withOrg(orgId, (tx) => auth.rotateInto(tx, session, orgId, meta, true), {
        userId,
      });
    },

    async listMembers(session: OrgSessionContext): Promise<MemberRow[]> {
      return db.withOrg(session.org.id, (tx) => listMembers(tx, session.org.id), {
        userId: session.user.id,
      });
    },

    async listInvites(session: OrgSessionContext): Promise<OpenInvite[]> {
      authorize(session.org, 'members.manage');
      return db.withOrg(session.org.id, (tx) => listOpenInvites(tx, session.org.id), {
        userId: session.user.id,
      });
    },

    /** FR-ORG-3: invite by email with a role; the link expires after 7 days. */
    async invite(
      session: OrgSessionContext,
      input: { email: string; role: Role },
      meta: RequestMeta,
    ): Promise<OpenInvite> {
      // Inviting never removes an owner, so the owner count is irrelevant here.
      authorizeMemberChange(session.org.role, { kind: 'invite', role: input.role }, Infinity);
      await auth.limitEmailTo(input.email);
      const orgId = session.org.id;
      const token = generateToken();
      const { invite, orgName } = await db.withOrg(
        orgId,
        async (tx) => {
          const members = await listMembers(tx, orgId);
          if (members.some((m) => sameEmail(m.email, input.email))) {
            throw new ConflictError('That person is already a member of this organization');
          }
          const created = await createInvite(tx, {
            orgId,
            email: input.email,
            role: input.role,
            tokenHash: hashToken(secret, token),
            invitedBy: session.user.id,
            expiresAt: new Date(Date.now() + TTL_MS.invite),
          });
          await recordAudit(tx, {
            orgId,
            actorId: session.user.id,
            action: 'member.invited',
            entityType: 'invite',
            entityId: created.id,
            after: {
              email: created.email,
              role: created.role,
              replacedOpenInvite: created.replaced,
            },
            ...meta,
          });
          const org = await getOrganization(tx, orgId);
          return { invite: created, orgName: org?.name ?? '' };
        },
        { userId: session.user.id },
      );
      await mailer.send({
        to: invite.email,
        ...emails.invite({
          inviterName: session.user.name,
          orgName,
          role: invite.role,
          url: emails.linkWithToken(appUrl, '/invite', token),
        }),
      });
      return {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
      };
    },

    async revokeInvite(
      session: OrgSessionContext,
      inviteId: string,
      meta: RequestMeta,
    ): Promise<void> {
      authorize(session.org, 'members.manage');
      await db.withOrg(
        session.org.id,
        async (tx) => {
          const revoked = await revokeInvite(tx, inviteId);
          if (revoked === null) throw new NotFoundError('Invitation not found');
          await recordAudit(tx, {
            orgId: session.org.id,
            actorId: session.user.id,
            action: 'invite.revoked',
            entityType: 'invite',
            entityId: inviteId,
            before: { email: revoked.email, role: revoked.role },
            ...meta,
          });
        },
        { userId: session.user.id },
      );
    },

    async changeRole(
      session: OrgSessionContext,
      membershipId: string,
      role: Role,
      meta: RequestMeta,
    ): Promise<void> {
      authorize(session.org, 'members.manage');
      await db.withOrg(
        session.org.id,
        async (tx) => {
          const target = await getMembershipById(tx, membershipId);
          if (target === null) throw new NotFoundError('Member not found');
          if (target.role === role) return;
          const owners = await lockOrgAndCountOwners(tx, session.org.id);
          authorizeMemberChange(
            session.org.role,
            { kind: 'change_role', from: target.role, to: role },
            owners,
          );
          await updateMembershipRole(tx, membershipId, role);
          await recordAudit(tx, {
            orgId: session.org.id,
            actorId: session.user.id,
            action: 'member.role_changed',
            entityType: 'membership',
            entityId: membershipId,
            before: { userId: target.userId, role: target.role },
            after: { userId: target.userId, role },
            ...meta,
          });
        },
        { userId: session.user.id },
      );
    },

    async removeMember(
      session: OrgSessionContext,
      membershipId: string,
      meta: RequestMeta,
    ): Promise<void> {
      authorize(session.org, 'members.manage');
      await db.withOrg(
        session.org.id,
        async (tx) => {
          const target = await getMembershipById(tx, membershipId);
          if (target === null) throw new NotFoundError('Member not found');
          const owners = await lockOrgAndCountOwners(tx, session.org.id);
          authorizeMemberChange(session.org.role, { kind: 'remove', role: target.role }, owners);
          // Deleting the membership also clears it as the active org of the member's
          // sessions (foreign key ON DELETE SET NULL), so access ends immediately.
          await deleteMembership(tx, membershipId);
          await recordAudit(tx, {
            orgId: session.org.id,
            actorId: session.user.id,
            action: 'member.removed',
            entityType: 'membership',
            entityId: membershipId,
            before: { userId: target.userId, role: target.role },
            ...meta,
          });
        },
        { userId: session.user.id },
      );
    },

    /** What the invite page shows before the invitee signs in or up. */
    async previewInvite(token: string): Promise<InvitePreview> {
      if (!isWellFormedToken(token))
        throw new GoneError('This invitation is invalid or has expired.');
      const invite = await db.auth.lookupInvite(hashToken(secret, token));
      if (invite === null) throw new GoneError('This invitation is invalid or has expired.');
      return {
        orgName: invite.org_name,
        email: invite.email,
        role: invite.role,
        status: inviteStatus(invite, new Date()),
      };
    },

    /** A signed-in user accepts an invite addressed to their own email. */
    async acceptInvite(
      session: SessionContext,
      token: string,
      meta: RequestMeta,
    ): Promise<IssuedSession> {
      const invite = await openInvite(token);
      if (!sameEmail(invite.email, session.user.email)) {
        throw new ForbiddenError(
          `This invitation was sent to ${invite.email}. Sign in with that address to accept it.`,
        );
      }
      return db.withOrg(
        invite.org_id,
        async (tx) => {
          await joinFromInvite(tx, invite, session.user.id, meta);
          return auth.rotateInto(tx, session, invite.org_id, meta, false);
        },
        { userId: session.user.id },
      );
    },

    /**
     * New user from an invite link: the address comes from the invite, and holding the link
     * proves control of that mailbox, so the account starts verified and signed in.
     */
    async signupFromInvite(
      input: { token: string; name: string; password: string },
      meta: RequestMeta,
    ): Promise<IssuedSession> {
      const invite = await openInvite(input.token);
      const passwordHash = await hashPassword(input.password);
      let userId: string;
      try {
        userId = await db.auth.registerUser({
          email: invite.email,
          name: input.name,
          passwordHash,
        });
      } catch (err) {
        if (!(err instanceof EmailTakenError)) throw err;
        throw new ConflictError(
          'An account with this email already exists. Sign in to accept the invitation.',
        );
      }
      await db.withUser(userId, (tx) => markEmailVerified(tx, userId));
      await db.withOrg(invite.org_id, (tx) => joinFromInvite(tx, invite, userId, meta), { userId });
      return auth.startSession(userId, meta, invite.org_id);
    },
  };
}
