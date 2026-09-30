/**
 * Readiness checks for /api/health. Each dependency check runs in parallel under its own
 * timeout. The report says which dependency failed but never why: error messages can carry
 * hostnames or credentials, so they go to the server log via `onFailure` only.
 */

export type DependencyName = 'database' | 'redis' | 'storage';

export interface HealthCheck {
  name: DependencyName;
  run(): Promise<void>;
}

export interface CheckResult {
  status: 'ok' | 'fail';
  latencyMs: number;
}

export interface HealthReport {
  status: 'ok' | 'unavailable';
  checks: Partial<Record<DependencyName, CheckResult>>;
}

export interface RunOptions {
  timeoutMs: number;
  onFailure?: (name: DependencyName, err: unknown) => void;
  /** Injected for tests; defaults to performance.now. */
  clock?: () => number;
}

export class HealthCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`health check timed out after ${String(timeoutMs)}ms`);
    this.name = 'HealthCheckTimeoutError';
  }
}

export async function runHealthChecks(
  checks: readonly HealthCheck[],
  options: RunOptions,
): Promise<HealthReport> {
  const clock = options.clock ?? (() => performance.now());
  const results = await Promise.all(
    checks.map(async (check): Promise<[DependencyName, CheckResult]> => {
      const start = clock();
      try {
        await withTimeout(check.run(), options.timeoutMs);
        return [check.name, { status: 'ok', latencyMs: Math.round(clock() - start) }];
      } catch (err) {
        options.onFailure?.(check.name, err);
        return [check.name, { status: 'fail', latencyMs: Math.round(clock() - start) }];
      }
    }),
  );
  const report: HealthReport = {
    status: results.every(([, result]) => result.status === 'ok') ? 'ok' : 'unavailable',
    checks: Object.fromEntries(results),
  };
  return report;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HealthCheckTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal slice of an ioredis client, so tests can pass real or fake clients. */
export interface RedisProbe {
  readonly status: string;
  connect(): Promise<void>;
  ping(): Promise<string>;
}

export function dependencyChecks(deps: {
  database: { ping(): Promise<void> };
  redis: RedisProbe;
  storage: { ping(): Promise<void> };
}): HealthCheck[] {
  return [
    { name: 'database', run: () => deps.database.ping() },
    {
      name: 'redis',
      run: async () => {
        // The client is created lazily; the first probe opens the connection.
        if (deps.redis.status === 'wait') await deps.redis.connect();
        const reply = await deps.redis.ping();
        if (reply !== 'PONG') throw new Error('unexpected PING reply');
      },
    },
    { name: 'storage', run: () => deps.storage.ping() },
  ];
}
