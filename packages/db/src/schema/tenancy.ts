import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ROLES } from '@invoiceguard/shared/permissions';
import { bytea, citext, createdAt, primaryId, updatedAt } from './columns';
import { users } from './identity';

export const membershipRole = pgEnum('membership_role', ROLES);

/** The tenant itself. Created only through `create_organization()`, which adds the owner. */
export const organizations = pgTable('organizations', {
  id: primaryId(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('trial'),
  stripeCustomerId: text('stripe_customer_id'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('memberships_org_user_uq').on(t.orgId, t.userId),
    index('memberships_user_id_idx').on(t.userId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: membershipRole('role').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // At most one open invite per address and org; re-inviting revokes the previous one.
    uniqueIndex('invites_open_email_uq')
      .on(t.orgId, t.email)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
  ],
);
