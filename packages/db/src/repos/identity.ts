import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { authTokens, sessions, userCredentials, users, type AuthTokenPurpose } from '../schema';

// Queries on the signed-in user's own identity rows. Run inside `withUser` (or `withOrg`
// with a userId); row-level security limits them to `app.user_id`.

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
}

export async function getUser(tx: Tx, userId: string): Promise<UserProfile | null> {
  const [row] = await tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/** Marks the address verified (idempotent). Used when an invite link proves the mailbox. */
export async function markEmailVerified(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(users)
    .set({ emailVerifiedAt: sql`now()` })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

export async function setPasswordHash(tx: Tx, userId: string, passwordHash: string): Promise<void> {
  await tx.update(userCredentials).set({ passwordHash }).where(eq(userCredentials.userId, userId));
}

export async function issueAuthToken(
  tx: Tx,
  input: { userId: string; purpose: AuthTokenPurpose; tokenHash: Buffer; expiresAt: Date },
): Promise<void> {
  await tx.insert(authTokens).values(input);
}

export async function insertSession(
  tx: Tx,
  input: {
    userId: string;
    tokenHash: Buffer;
    activeOrgId: string | null;
    expiresAt: Date;
    userAgent: string | null;
  },
): Promise<string> {
  const [row] = await tx
    .insert(sessions)
    .values({ ...input, userAgent: input.userAgent?.slice(0, 512) ?? null })
    .returning({ id: sessions.id });
  if (row === undefined) throw new Error('session insert returned no row');
  return row.id;
}

/**
 * Replaces the session's token and active org in one update: switching org is a privilege
 * change, so the old cookie value stops working (session fixation defence).
 */
export async function rotateSession(
  tx: Tx,
  sessionId: string,
  input: { tokenHash: Buffer; activeOrgId: string | null },
): Promise<boolean> {
  const rows = await tx
    .update(sessions)
    .set(input)
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function deleteSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Signs the user out everywhere, optionally keeping one session. */
export async function deleteUserSessions(
  tx: Tx,
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  await tx
    .delete(sessions)
    .where(
      exceptSessionId === undefined
        ? eq(sessions.userId, userId)
        : and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)),
    );
}

/** The org of the user's most recent session that had one, to reopen it at next sign-in. */
export async function lastActiveOrgId(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ orgId: sessions.activeOrgId })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNotNull(sessions.activeOrgId)))
    .orderBy(desc(sessions.createdAt))
    .limit(1);
  return row?.orgId ?? null;
}
