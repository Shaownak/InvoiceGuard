import type { AuditAction, AuditEntityType } from '@invoiceguard/shared/audit';
import type { Tx } from '../client';
import { auditLog } from '../schema';

export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Client address, only when it can be trusted (TRUST_PROXY_HEADERS); must parse as inet. */
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Appends one entry. `before`/`after` hold only the fields that changed and never secrets,
 * tokens, or document text (CLAUDE.md rule 5). Runs in the caller's transaction, so the entry
 * commits or rolls back with the change it describes.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: entry.orgId,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 512) ?? null,
  });
}
