import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { Role } from '@invoiceguard/shared/permissions';
import type { Tx } from '../client';
import { memberships, organizations } from '../schema';

/** Lowercase ASCII words joined by hyphens, at most 40 characters; "org" when nothing remains. */
export function slugBase(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug === '' ? 'org' : slug;
}

/**
 * Creates an organization owned by the transaction's user (`withUser`), via the
 * `create_organization` SECURITY DEFINER function. Returns the new org id.
 */
export async function createOrganization(tx: Tx, name: string): Promise<string> {
  const res = await tx.execute<{ id: string }>(
    sql`SELECT create_organization(${name}, ${slugBase(name)}) AS id`,
  );
  const id = res.rows[0]?.id;
  if (id === undefined) throw new Error('create_organization returned no id');
  return id;
}

export interface OrganizationSummary {
  orgId: string;
  name: string;
  role: Role;
}

/** The user's organizations with their role in each, oldest membership first. */
export async function listUserOrganizations(
  tx: Tx,
  userId: string,
): Promise<OrganizationSummary[]> {
  return tx
    .select({ orgId: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}

export async function getOrganization(
  tx: Tx,
  orgId: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [row] = await tx
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row ?? null;
}

/**
 * Locks the org row, then counts its owners. Every membership change that could remove an
 * owner calls this first, so two concurrent demotions cannot both see "another owner left".
 */
export async function lockOrgAndCountOwners(tx: Tx, orgId: string): Promise<number> {
  await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for('update');
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
  return row?.n ?? 0;
}
