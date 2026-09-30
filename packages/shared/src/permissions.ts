import { z } from 'zod';
import { ConflictError, ForbiddenError } from './errors';

/**
 * The permission matrix (ARCHITECTURE.md section 10), defined once. Every route and page
 * checks access through `authorize` or `can`; nothing else compares role names.
 */

export const ROLES = ['owner', 'admin', 'approver', 'reviewer', 'viewer'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * One capability per matrix row. "Confirm/dismiss findings" is split in two because the
 * matrix gives reviewers "recommend only": they may record a recommendation, not the outcome.
 */
export const PERMISSIONS = {
  'invoices.view': ['owner', 'admin', 'approver', 'reviewer', 'viewer'],
  'invoices.upload': ['owner', 'admin', 'approver', 'reviewer'],
  'invoices.edit': ['owner', 'admin', 'approver', 'reviewer'],
  'findings.recommend': ['owner', 'admin', 'approver', 'reviewer'],
  'findings.resolve': ['owner', 'admin', 'approver'],
  'invoices.decide': ['owner', 'admin', 'approver'],
  'masterdata.import': ['owner', 'admin'],
  'settings.manage': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'billing.manage': ['owner'],
  'org.delete': ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof PERMISSIONS;
export const CAPABILITIES = Object.keys(PERMISSIONS) as Capability[];

/** Whether `role` holds `capability`. */
export function can(role: Role, capability: Capability): boolean {
  return (PERMISSIONS[capability] as readonly Role[]).includes(role);
}

/** Throws ForbiddenError unless `role` holds `capability`. */
export function authorize(actor: { role: Role }, capability: Capability): void {
  if (!can(actor.role, capability)) throw new ForbiddenError();
}

export type MemberChange =
  | { kind: 'invite'; role: Role }
  | { kind: 'change_role'; from: Role; to: Role }
  | { kind: 'remove'; role: Role };

export interface MemberChangeRefusal {
  code: 'forbidden' | 'conflict';
  message: string;
}

/**
 * Rules for changing membership beyond the matrix row "Manage members":
 * - granting, changing, or removing the owner role needs an owner (no escalation by admins);
 * - the last owner of an organization cannot be demoted or removed.
 * `ownerCount` is the number of owners before the change. Returns null when allowed.
 */
export function memberChangeRefusal(
  actorRole: Role,
  change: MemberChange,
  ownerCount: number,
): MemberChangeRefusal | null {
  if (!can(actorRole, 'members.manage')) {
    return { code: 'forbidden', message: 'You do not have permission to manage members' };
  }
  const touchesOwner =
    (change.kind === 'invite' && change.role === 'owner') ||
    (change.kind === 'change_role' && (change.from === 'owner' || change.to === 'owner')) ||
    (change.kind === 'remove' && change.role === 'owner');
  if (touchesOwner && actorRole !== 'owner') {
    return { code: 'forbidden', message: 'Only an owner can grant or remove the owner role' };
  }
  const losesOwner =
    (change.kind === 'change_role' && change.from === 'owner' && change.to !== 'owner') ||
    (change.kind === 'remove' && change.role === 'owner');
  if (losesOwner && ownerCount <= 1) {
    return { code: 'conflict', message: 'An organization must keep at least one owner' };
  }
  return null;
}

/** Throws ForbiddenError or ConflictError when `memberChangeRefusal` refuses the change. */
export function authorizeMemberChange(
  actorRole: Role,
  change: MemberChange,
  ownerCount: number,
): void {
  const refusal = memberChangeRefusal(actorRole, change, ownerCount);
  if (refusal === null) return;
  throw refusal.code === 'forbidden'
    ? new ForbiddenError(refusal.message)
    : new ConflictError(refusal.message);
}
