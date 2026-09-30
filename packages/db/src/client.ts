import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';
import { createAuthGateway, type AuthGateway } from './auth-gateway';
import * as schema from './schema';

export type Schema = typeof schema;
type Orm = NodePgDatabase<Schema>;
/** A Drizzle transaction whose row-level security context is already set. */
export type Tx = Parameters<Parameters<Orm['transaction']>[0]>[0];

/**
 * Database handle for app code. The pg pool stays private to this package; every query runs
 * inside one of three reviewed entry points (ADR-0015):
 *
 * - `withOrg(orgId, fn, { userId })`: tenant work. Row-level security limits every tenant
 *   table to `orgId`, even when a query forgets its `org_id` filter.
 * - `withUser(userId, fn)`: the signed-in user's own rows outside any org (profile,
 *   sessions, memberships for the org switcher, creating an org).
 * - `auth`: the few SECURITY DEFINER lookups that must run before a context exists.
 */
export interface Database {
  withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>, options?: { userId?: string }): Promise<T>;
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  readonly auth: AuthGateway;
  /**
   * Round-trips a query and verifies the connected role is bound by row-level security
   * (not superuser, not BYPASSRLS, not a member of the owner role). Used by readiness, so a
   * deployment pointed at the owner URL by mistake reports unhealthy instead of serving.
   */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  applicationName: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  /** Called for errors on idle pooled connections, which would otherwise crash the process. */
  onBackgroundError?: (err: Error) => void;
}

const uuidSchema = z.uuid();

/** Thrown by `ping` when the connected role could bypass row-level security. */
export class UnsafeDatabaseRoleError extends Error {
  constructor(role: string) {
    super(`database role "${role}" can bypass row-level security; connect as the app role`);
    this.name = 'UnsafeDatabaseRoleError';
  }
}

export function createDatabase(url: string, options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: url,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 30_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err) => options.onBackgroundError?.(err));
  const orm = drizzle(pool, { schema });

  async function inContext<T>(
    context: { orgId: string | null; userId: string | null },
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    // Validated so a malformed id fails here with a clear message, not as a cast error
    // inside some later policy check. Values are bound parameters, never interpolated.
    if (context.orgId !== null && !uuidSchema.safeParse(context.orgId).success) {
      throw new TypeError('database context: orgId must be a UUID');
    }
    if (context.userId !== null && !uuidSchema.safeParse(context.userId).success) {
      throw new TypeError('database context: userId must be a UUID');
    }
    return orm.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.org_id', ${context.orgId ?? ''}, true),
                   set_config('app.user_id', ${context.userId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  return {
    withOrg: (orgId, fn, opts) => inContext({ orgId, userId: opts?.userId ?? null }, fn),
    withUser: (userId, fn) => inContext({ orgId: null, userId }, fn),
    auth: createAuthGateway(orm),
    async ping() {
      const res = await pool.query<{ role: string; bypass: boolean }>(
        `SELECT current_user AS role,
                (r.rolsuper OR r.rolbypassrls OR pg_has_role(current_user, 'ig_owner', 'MEMBER')) AS bypass
         FROM pg_roles r WHERE r.rolname = current_user`,
      );
      const row = res.rows[0];
      if (row === undefined || row.bypass) throw new UnsafeDatabaseRoleError(row?.role ?? '?');
    },
    async close() {
      await pool.end();
    },
  };
}
