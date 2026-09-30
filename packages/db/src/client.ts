import pg from 'pg';

/**
 * Database handle for app code. The pg pool stays private to this package: from M1 the only
 * way to run tenant queries is `withOrg(orgId, fn)`, which sets `app.org_id` for the
 * transaction so row-level security applies (ARCHITECTURE.md section 5).
 */
export interface Database {
  /** Round-trips a trivial query; used by readiness checks. */
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

  return {
    async ping() {
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },
  };
}
