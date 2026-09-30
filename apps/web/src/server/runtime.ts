import { Redis } from 'ioredis';
import { createDatabase, type Database } from '@invoiceguard/db';
import { parseEnv, webEnvSchema, type WebEnv } from '@invoiceguard/shared/env';
import { loadWorkspaceEnvFile } from '@invoiceguard/shared/env-file';
import { createLogger, type Logger } from '@invoiceguard/shared/logger';
import { createStorage, type ObjectStorage } from '@invoiceguard/storage';

/**
 * Process-wide server dependencies, created once on first use. Cached on globalThis so
 * Next.js dev hot reloads do not open a new pool on every edit.
 */
export interface Runtime {
  env: WebEnv;
  logger: Logger;
  database: Database;
  redis: Redis;
  storage: ObjectStorage;
}

const holder = globalThis as typeof globalThis & { __invoiceguardRuntime?: Runtime };

export function getRuntime(): Runtime {
  holder.__invoiceguardRuntime ??= createRuntime();
  return holder.__invoiceguardRuntime;
}

/** Validates configuration without opening connections; called at server boot. */
export function loadWebEnv(): WebEnv {
  loadWorkspaceEnvFile();
  return parseEnv(webEnvSchema, process.env);
}

function createRuntime(): Runtime {
  const env = loadWebEnv();
  const logger = createLogger({ name: 'web', level: env.LOG_LEVEL });
  const database = createDatabase(env.DATABASE_URL, {
    applicationName: 'ig-web',
    connectionTimeoutMs: 2_000,
    onBackgroundError: (err) => {
      logger.warn({ err: err.message }, 'idle database connection error');
    },
  });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', (err: Error) => {
    logger.debug({ err: err.message }, 'redis connection error');
  });
  return { env, logger, database, redis, storage: createStorage(env) };
}

/** Closes connections and forgets the runtime (tests and graceful shutdown). */
export async function closeRuntime(): Promise<void> {
  const runtime = holder.__invoiceguardRuntime;
  holder.__invoiceguardRuntime = undefined;
  if (runtime === undefined) return;
  runtime.redis.disconnect();
  await runtime.database.close();
}
