import { parseEnv, workerEnvSchema } from '@invoiceguard/shared/env';
import { loadWorkspaceEnvFile } from '@invoiceguard/shared/env-file';
import { createLogger } from '@invoiceguard/shared/logger';
import { createWorkerConnection, startWorkers } from './workers';

loadWorkspaceEnvFile();
// Fail fast at boot on invalid configuration (ConfigError lists variable names only).
const env = parseEnv(workerEnvSchema, process.env);
const logger = createLogger({ name: 'worker', level: env.LOG_LEVEL });

const connection = createWorkerConnection(env.REDIS_URL);
connection.on('error', (err: Error) => {
  logger.warn({ err: err.message }, 'redis connection error');
});

const workers = startWorkers({ connection, concurrency: env.WORKER_CONCURRENCY, logger });
logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  await workers.close();
  await connection.quit();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
