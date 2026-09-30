import { Queue, QueueEvents } from 'bullmq';
import { QUEUES, deterministicJobId } from '@invoiceguard/shared/queues';
import { createLogger } from '@invoiceguard/shared/logger';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createWorkerConnection, startWorkers } from './workers';

describe('system worker (real Redis)', () => {
  const { redisUrl } = inject('testInfra');
  const connection = createWorkerConnection(redisUrl);
  const producer = createWorkerConnection(redisUrl);
  const events = new QueueEvents(QUEUES.system, { connection: createWorkerConnection(redisUrl) });
  const queue = new Queue(QUEUES.system, { connection: producer });
  const workers = startWorkers({
    connection,
    concurrency: 1,
    logger: createLogger({ name: 'test', level: 'silent' }),
  });

  afterAll(async () => {
    await workers.close();
    await queue.close();
    await events.close();
    connection.disconnect();
    producer.disconnect();
  });

  it('processes a ping job end to end', async () => {
    await events.waitUntilReady();
    const job = await queue.add('ping', { nonce: 'n-1' });
    await expect(job.waitUntilFinished(events, 15_000)).resolves.toEqual({ pong: 'n-1' });
  });

  it('dedupes jobs by deterministic id (idempotent enqueue)', async () => {
    const jobId = deterministicJobId('ping', 'fixed');
    const a = await queue.add('ping', { nonce: 'n-2' }, { jobId });
    const b = await queue.add('ping', { nonce: 'n-2' }, { jobId });
    expect(b.id).toBe(a.id);
    await a.waitUntilFinished(events, 15_000);
    expect(await queue.getJobCountByTypes('completed')).toBeGreaterThanOrEqual(1);
  });

  it('fails invalid payloads without retrying', async () => {
    const job = await queue.add('ping', { nonce: 7 }, { attempts: 3 });
    await expect(job.waitUntilFinished(events, 15_000)).rejects.toThrow(/Invalid payload/);
    const reloaded = await queue.getJob(job.id ?? '');
    expect(reloaded?.attemptsMade).toBe(1);
  });
});
