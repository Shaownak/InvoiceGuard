import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { roleSchema } from '@invoiceguard/shared/permissions';
import type { AuthTokenPurpose } from './schema';

/**
 * Pre-authentication lookups. Each method calls one SECURITY DEFINER function from the M1
 * migration; with no context set, row-level security hides every table from the app role,
 * so these are the only way to find a user or session before knowing who is asking.
 */
export interface AuthGateway {
  findUserByEmail(email: string): Promise<UserWithCredentials | null>;
  /** Creates an unverified user. Throws `EmailTakenError` when the address is registered. */
  registerUser(input: { email: string; name: string; passwordHash: string }): Promise<string>;
  lookupSession(tokenHash: Buffer): Promise<SessionRecord | null>;
  /** Marks a live, unused token as used and returns its user id, or null. */
  consumeToken(tokenHash: Buffer, purpose: AuthTokenPurpose): Promise<string | null>;
  lookupInvite(tokenHash: Buffer): Promise<InviteRecord | null>;
}

export class EmailTakenError extends Error {
  constructor() {
    super('email already registered');
    this.name = 'EmailTakenError';
  }
}

// Drizzle's raw `execute` returns timestamptz values as ISO strings.
const timestamp = z.coerce.date();

const userWithCredentialsSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  email_verified_at: timestamp.nullable(),
  password_hash: z.string().nullable(),
});
export type UserWithCredentials = z.infer<typeof userWithCredentialsSchema>;

const sessionRecordSchema = z.object({
  session_id: z.uuid(),
  user_id: z.uuid(),
  expires_at: timestamp,
  active_org_id: z.uuid().nullable(),
  role: roleSchema.nullable(),
  email: z.string(),
  name: z.string(),
  email_verified_at: timestamp.nullable(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

const inviteRecordSchema = z.object({
  invite_id: z.uuid(),
  org_id: z.uuid(),
  org_name: z.string(),
  email: z.string(),
  role: roleSchema,
  expires_at: timestamp,
  accepted_at: timestamp.nullable(),
  revoked_at: timestamp.nullable(),
});
export type InviteRecord = z.infer<typeof inviteRecordSchema>;

/**
 * The Postgres SQLSTATE of an error, looking through wrappers (Drizzle wraps driver errors
 * in `cause`). Undefined for non-database errors.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      return current.code;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}

/** The slice of Drizzle the gateway needs; queries run outside any transaction or context. */
interface Executor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

export function createAuthGateway(orm: Executor): AuthGateway {
  async function rows(query: SQL): Promise<unknown[]> {
    const res = await orm.execute(query);
    return res.rows;
  }

  async function first<S extends z.ZodType>(schema: S, query: SQL): Promise<z.infer<S> | null> {
    const [row] = await rows(query);
    return row === undefined ? null : schema.parse(row);
  }

  return {
    findUserByEmail: (email) =>
      first(userWithCredentialsSchema, sql`SELECT * FROM auth_find_user_by_email(${email})`),

    async registerUser({ email, name, passwordHash }) {
      try {
        const row = await first(
          z.object({ id: z.uuid() }),
          sql`SELECT auth_register_user(${email}, ${name}, ${passwordHash}) AS id`,
        );
        if (row === null) throw new Error('auth_register_user returned no row');
        return row.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw new EmailTakenError();
        throw err;
      }
    },

    lookupSession: (tokenHash) =>
      first(sessionRecordSchema, sql`SELECT * FROM auth_session_lookup(${tokenHash})`),

    async consumeToken(tokenHash, purpose) {
      const row = await first(
        z.object({ user_id: z.uuid().nullable() }),
        sql`SELECT auth_consume_token(${tokenHash}, ${purpose}::auth_token_purpose) AS user_id`,
      );
      return row?.user_id ?? null;
    },

    lookupInvite: (tokenHash) =>
      first(inviteRecordSchema, sql`SELECT * FROM invite_lookup(${tokenHash})`),
  };
}
