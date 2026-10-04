import { index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from './columns';
import { organizations } from './tenancy';

/**
 * Append-only: the app role holds only SELECT and INSERT, and a trigger rejects UPDATE,
 * DELETE and TRUNCATE for every role (ADR-0016). `actor_id` has no foreign key so entries
 * outlive the user they name.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_org_created_idx').on(t.orgId, t.createdAt.desc())],
);
