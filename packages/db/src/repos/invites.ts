import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Role } from '@invoiceguard/shared/permissions';
import type { Tx } from '../client';
import { invites } from '../schema';

export interface OpenInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

const openInviteColumns = {
  id: invites.id,
  email: invites.email,
  role: invites.role,
  expiresAt: invites.expiresAt,
  createdAt: invites.createdAt,
};

const isOpen = and(isNull(invites.acceptedAt), isNull(invites.revokedAt));

/**
 * Creates an invite, first revoking any open invite for the same address in this org, so
 * re-inviting (for example to resend after expiry) leaves exactly one valid link.
 */
export async function createInvite(
  tx: Tx,
  input: {
    orgId: string;
    email: string;
    role: Role;
    tokenHash: Buffer;
    invitedBy: string;
    expiresAt: Date;
  },
): Promise<OpenInvite & { replaced: boolean }> {
  const revoked = await tx
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(invites.orgId, input.orgId), eq(invites.email, input.email), isOpen))
    .returning({ id: invites.id });
  const [created] = await tx.insert(invites).values(input).returning(openInviteColumns);
  if (created === undefined) throw new Error('invite insert returned no row');
  return { ...created, replaced: revoked.length > 0 };
}

/** Open (not accepted, not revoked) invites, including expired ones so admins can resend. */
export async function listOpenInvites(tx: Tx, orgId: string): Promise<OpenInvite[]> {
  return tx
    .select(openInviteColumns)
    .from(invites)
    .where(and(eq(invites.orgId, orgId), isOpen))
    .orderBy(asc(invites.createdAt));
}

/** Revokes an open invite; returns it, or null when there was nothing open to revoke. */
export async function revokeInvite(tx: Tx, id: string): Promise<OpenInvite | null> {
  const [row] = await tx
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(invites.id, id), isOpen))
    .returning(openInviteColumns);
  return row ?? null;
}

/** Marks an open invite accepted. Returns false if it was already accepted or revoked. */
export async function markInviteAccepted(tx: Tx, id: string, userId: string): Promise<boolean> {
  const rows = await tx
    .update(invites)
    .set({ acceptedAt: sql`now()`, acceptedBy: userId })
    .where(and(eq(invites.id, id), isOpen))
    .returning({ id: invites.id });
  return rows.length > 0;
}
