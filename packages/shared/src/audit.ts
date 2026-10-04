/**
 * Audit log vocabulary (CLAUDE.md rule 9). Actions are `entity.verb`; the audit log page
 * (FR-ADM-1) filters on them, so add new ones here rather than inlining strings.
 */
export const AUDIT_ACTIONS = [
  'org.created',
  'member.invited',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'invite.revoked',
  'session.signed_in',
  'session.org_switched',
  'user.password_reset',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'organization',
  'membership',
  'invite',
  'session',
  'user',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
