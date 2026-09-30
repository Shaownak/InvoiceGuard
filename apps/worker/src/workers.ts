import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES } from '@invoiceguard/shared/queues';
import type { Logger } from '@invoiceguard/shared/logger';
import { processSystemJob } from './processors/system';

export interface RunningWorkers {
  close(): Promise<void>;
}

/** BullMQ workers need a connection that retries forever instead of failing commands. */
export function createWorkerConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function startWorkers(options: {
  connection: Redis;
  concurrency: number;
  logger: Logger;
}): RunningWorkers {
  const system = new Worker(QUEUES.system, processSystemJob, {
    connection: options.connection,
    concurrency: options.concurrency,
  });
  // Log ids and names only: job payloads may carry document-derived data (CLAUDE.md rule 5).
  system.on('failed', (job, err) => {
    options.logger.warn({ jobId: job?.id, jobName: job?.name, err: err.message }, 'job failed');
  });
  system.on('error', (err) => {
    options.logger.error({ err }, 'worker error');
  });

  return {
    async close() {
      await system.close();
    },
  };
}
