import { and, asc, eq } from 'drizzle-orm';
import type { Role } from '@invoiceguard/shared/permissions';
import type { Tx } from '../client';
import { memberships, users } from '../schema';

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: Role;
}

const membershipColumns = {
  id: memberships.id,
  orgId: memberships.orgId,
  userId: memberships.userId,
  role: memberships.role,
};

export async function getMembership(
  tx: Tx,
  orgId: string,
  userId: string,
): Promise<Membership | null> {
  const [row] = await tx
    .select(membershipColumns)
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return row ?? null;
}

export async function getMembershipById(tx: Tx, id: string): Promise<Membership | null> {
  const [row] = await tx.select(membershipColumns).from(memberships).where(eq(memberships.id, id));
  return row ?? null;
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
}

/** Members of the transaction's org. Relies on RLS for the org scope and filters anyway. */
export async function listMembers(tx: Tx, orgId: string): Promise<MemberRow[]> {
  return tx
    .select({
      membershipId: memberships.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(memberships.createdAt));
}

/** Idempotent: an existing membership is left unchanged and returned with `created: false`. */
export async function addMembership(
  tx: Tx,
  input: { orgId: string; userId: string; role: Role },
): Promise<{ membership: Membership; created: boolean }> {
  const [inserted] = await tx
    .insert(memberships)
    .values(input)
    .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] })
    .returning(membershipColumns);
  if (inserted !== undefined) return { membership: inserted, created: true };
  const existing = await getMembership(tx, input.orgId, input.userId);
  if (existing === null) throw new Error('membership conflict without a visible row');
  return { membership: existing, created: false };
}

export async function updateMembershipRole(tx: Tx, id: string, role: Role): Promise<void> {
  await tx.update(memberships).set({ role }).where(eq(memberships.id, id));
}

export async function deleteMembership(tx: Tx, id: string): Promise<void> {
  await tx.delete(memberships).where(eq(memberships.id, id));
}
