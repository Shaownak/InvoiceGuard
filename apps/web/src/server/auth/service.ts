import {
  EmailTakenError,
  createOrganization,
  deleteSession,
  deleteUserSessions,
  getMembership,
  insertSession,
  issueAuthToken,
  lastActiveOrgId,
  listUserOrganizations,
  recordAudit,
  rotateSession,
  setPasswordHash,
  type AuthTokenPurpose,
  type Tx,
} from '@invoiceguard/db';
import {
  EmailNotVerifiedError,
  GoneError,
  RateLimitedError,
  UnauthenticatedError,
} from '@invoiceguard/shared/errors';
import * as emails from '../email/templates';
import { LIMITS } from '../rate-limit';
import type { IssuedSession, RequestMeta, ServiceDeps, SessionContext } from '../services';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { emailFingerprint, generateToken, hashToken, isWellFormedToken } from './tokens';

const HOUR_MS = 60 * 60 * 1000;

/** Lifetimes: session 30 days; email links per ADR-0007; invites 7 days (FR-ORG-3). */
export const TTL_MS = {
  session: 30 * 24 * HOUR_MS,
  verify_email: 24 * HOUR_MS,
  password_reset: HOUR_MS,
  magic_link: 15 * 60 * 1000,
  invite: 7 * 24 * HOUR_MS,
} as const satisfies Record<AuthTokenPurpose | 'session' | 'invite', number>;

const LINK_PATHS: Record<AuthTokenPurpose, string> = {
  verify_email: '/verify-email',
  password_reset: '/reset-password/confirm',
  magic_link: '/magic-link',
};

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(deps: ServiceDeps) {
  const { db, mailer, limiter, secret, appUrl, logger } = deps;
  const hash = (token: string) => hashToken(secret, token);

  /** Counts one email to this address; callers invoke it before any work that sends one. */
  async function limitEmailTo(email: string): Promise<void> {
    await limiter.hit(`email:${emailFingerprint(secret, email)}`, ...LIMITS.emailSend);
  }

  async function sendLink(
    userId: string,
    email: string,
    purpose: AuthTokenPurpose,
    render: (url: string) => emails.RenderedEmail,
  ): Promise<void> {
    const token = generateToken();
    await db.withUser(userId, (tx) =>
      issueAuthToken(tx, {
        userId,
        purpose,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + TTL_MS[purpose]),
      }),
    );
    await mailer.send({
      to: email,
      ...render(emails.linkWithToken(appUrl, LINK_PATHS[purpose], token)),
    });
  }

  async function consumeLink(token: string, purpose: AuthTokenPurpose): Promise<string> {
    if (!isWellFormedToken(token)) throw new GoneError();
    const userId = await db.auth.consumeToken(hash(token), purpose);
    if (userId === null) throw new GoneError();
    return userId;
  }

  /**
   * Opens a session in `preferredOrgId`, else the org of the user's last session, else their
   * first org. The sign-in is audited in the org it opens.
   */
  async function startSession(
    userId: string,
    meta: RequestMeta,
    preferredOrgId?: string,
  ): Promise<IssuedSession> {
    const orgId = await db.withUser(userId, async (tx) => {
      for (const candidate of [preferredOrgId ?? null, await lastActiveOrgId(tx, userId)]) {
        if (candidate !== null && (await getMembership(tx, candidate, userId)) !== null) {
          return candidate;
        }
      }
      return (await listUserOrganizations(tx, userId))[0]?.orgId ?? null;
    });
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_MS.session);
    const write = async (tx: Tx) => {
      const sessionId = await insertSession(tx, {
        userId,
        tokenHash: hash(token),
        activeOrgId: orgId,
        expiresAt,
        userAgent: meta.userAgent,
      });
      if (orgId !== null) {
        await recordAudit(tx, {
          orgId,
          actorId: userId,
          action: 'session.signed_in',
          entityType: 'session',
          entityId: sessionId,
          ...meta,
        });
      }
    };
    if (orgId === null) await db.withUser(userId, write);
    else await db.withOrg(orgId, write, { userId });
    return { token, expiresAt, orgId };
  }

  /**
   * Replaces the session's token and moves it to `orgId`, auditing the switch in that org.
   * The caller must already have checked the membership (or created it) in `tx`'s org.
   */
  async function rotateInto(
    tx: Tx,
    session: SessionContext,
    orgId: string,
    meta: RequestMeta,
    audit: boolean,
  ): Promise<IssuedSession> {
    const token = generateToken();
    const ok = await rotateSession(tx, session.sessionId, {
      tokenHash: hash(token),
      activeOrgId: orgId,
    });
    if (!ok) throw new UnauthenticatedError();
    if (audit) {
      await recordAudit(tx, {
        orgId,
        actorId: session.user.id,
        action: 'session.org_switched',
        entityType: 'session',
        entityId: session.sessionId,
        before: { orgId: session.org?.id ?? null },
        after: { orgId },
        ...meta,
      });
    }
    // Rotation does not extend the session; the new cookie expires with the old one.
    return { token, expiresAt: session.expiresAt, orgId };
  }

  return {
    startSession,
    rotateInto,
    limitEmailTo,

    /** Resolves a session cookie value; null when missing, malformed, expired, or revoked. */
    async authenticate(token: string): Promise<SessionContext | null> {
      if (!isWellFormedToken(token)) return null;
      const record = await db.auth.lookupSession(hash(token));
      if (record === null || record.email_verified_at === null) return null;
      return {
        sessionId: record.session_id,
        expiresAt: record.expires_at,
        user: { id: record.user_id, email: record.email, name: record.name },
        org:
          record.active_org_id !== null && record.role !== null
            ? { id: record.active_org_id, role: record.role }
            : null,
      };
    },

    /**
     * Self-serve signup (FR-AUTH-1). Creates an unverified user and their organization, then
     * emails a confirmation link; no session until the email is confirmed. For an address that
     * is already registered it emails the owner instead, and the caller sees the same result,
     * so signup does not reveal which emails have accounts.
     */
    async signup(
      input: { name: string; email: string; password: string; orgName: string },
      meta: RequestMeta,
    ): Promise<void> {
      await limitEmailTo(input.email);
      const passwordHash = await hashPassword(input.password);
      let userId: string;
      try {
        userId = await db.auth.registerUser({ email: input.email, name: input.name, passwordHash });
      } catch (err) {
        if (!(err instanceof EmailTakenError)) throw err;
        await mailer.send({
          to: input.email,
          ...emails.accountExists({ loginUrl: new URL('/login', appUrl).toString() }),
        });
        return;
      }
      const orgId = await db.withUser(userId, (tx) => createOrganization(tx, input.orgName));
      await db.withOrg(
        orgId,
        (tx) =>
          recordAudit(tx, {
            orgId,
            actorId: userId,
            action: 'org.created',
            entityType: 'organization',
            entityId: orgId,
            after: { name: input.orgName },
            ...meta,
          }),
        { userId },
      );
      await sendLink(userId, input.email, 'verify_email', (url) =>
        emails.verifyEmail({ name: input.name, url }),
      );
    },

    /** Always succeeds from the caller's view; sends only to unverified accounts. */
    async resendVerification(email: string): Promise<void> {
      await limitEmailTo(email);
      const user = await db.auth.findUserByEmail(email);
      if (user === null || user.email_verified_at !== null) return;
      await sendLink(user.id, user.email, 'verify_email', (url) =>
        emails.verifyEmail({ name: user.name, url }),
      );
    },

    async verifyEmail(token: string, meta: RequestMeta): Promise<IssuedSession> {
      return startSession(await consumeLink(token, 'verify_email'), meta);
    },

    async login(
      input: { email: string; password: string },
      meta: RequestMeta,
    ): Promise<IssuedSession> {
      const fingerprint = emailFingerprint(secret, input.email);
      await limiter.hit(`login:${fingerprint}`, ...LIMITS.login);
      const user = await db.auth.findUserByEmail(input.email);
      const valid =
        user !== null && user.password_hash !== null
          ? await verifyPassword(user.password_hash, input.password)
          : await verifyAgainstDummy(input.password);
      if (user === null || !valid) {
        // The fingerprint lets operators spot credential stuffing without logging the address.
        logger.warn({ emailFingerprint: fingerprint }, 'sign-in failed');
        throw new UnauthenticatedError('Email or password is incorrect');
      }
      if (user.email_verified_at === null) {
        try {
          await limitEmailTo(user.email);
          await sendLink(user.id, user.email, 'verify_email', (url) =>
            emails.verifyEmail({ name: user.name, url }),
          );
        } catch (err) {
          if (!(err instanceof RateLimitedError)) throw err;
        }
        throw new EmailNotVerifiedError();
      }
      return startSession(user.id, meta);
    },

    async logout(session: SessionContext): Promise<void> {
      await db.withUser(session.user.id, (tx) => deleteSession(tx, session.sessionId));
    },

    /** Magic-link sign-in (FR-AUTH-1). Silent for unknown addresses. */
    async requestMagicLink(email: string): Promise<void> {
      await limitEmailTo(email);
      const user = await db.auth.findUserByEmail(email);
      if (user === null) return;
      await sendLink(user.id, user.email, 'magic_link', (url) => emails.magicLink({ url }));
    },

    async consumeMagicLink(token: string, meta: RequestMeta): Promise<IssuedSession> {
      return startSession(await consumeLink(token, 'magic_link'), meta);
    },

    /** Password reset request (FR-AUTH-2). Silent for unknown addresses. */
    async requestPasswordReset(email: string): Promise<void> {
      await limitEmailTo(email);
      const user = await db.auth.findUserByEmail(email);
      if (user === null) return;
      await sendLink(user.id, user.email, 'password_reset', (url) => emails.passwordReset({ url }));
    },

    /**
     * Sets a new password, signs the user out everywhere, audits the reset in each of their
     * orgs (ADR-0016), and opens a fresh session.
     */
    async resetPassword(
      token: string,
      password: string,
      meta: RequestMeta,
    ): Promise<IssuedSession> {
      const passwordHash = await hashPassword(password);
      const userId = await consumeLink(token, 'password_reset');
      const orgs = await db.withUser(userId, async (tx) => {
        await setPasswordHash(tx, userId, passwordHash);
        await deleteUserSessions(tx, userId);
        return listUserOrganizations(tx, userId);
      });
      for (const { orgId } of orgs) {
        await db.withOrg(
          orgId,
          (tx) =>
            recordAudit(tx, {
              orgId,
              actorId: userId,
              action: 'user.password_reset',
              entityType: 'user',
              entityId: userId,
              ...meta,
            }),
          { userId },
        );
      }
      return startSession(userId, meta);
    },
  };
}
