import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea, citext, createdAt, primaryId, updatedAt } from './columns';

// Identity tables are global (no org_id). Row-level security still applies: the app role sees
// only the rows of the user in `app.user_id`, plus co-members' `users` rows in the current
// org. Pre-authentication lookups go through SECURITY DEFINER functions.

export const users = pgTable('users', {
  id: primaryId(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Kept apart from `users` so co-members, who may read `users`, never see password hashes. */
export const userCredentials = pgTable('user_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    // Composite FK to memberships (org_id, user_id) with ON DELETE SET NULL (active_org_id),
    // declared in SQL because Drizzle cannot express the column list.
    activeOrgId: uuid('active_org_id'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const AUTH_TOKEN_PURPOSES = ['verify_email', 'password_reset', 'magic_link'] as const;
export const authTokenPurpose = pgEnum('auth_token_purpose', AUTH_TOKEN_PURPOSES);
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

/** Single-use email tokens, stored as HMAC hashes. Consumed by `auth_consume_token()`. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose)],
);
