import { UnrecoverableError } from 'bullmq';
import { systemJobSchema, type SystemJob } from '@invoiceguard/shared/queues';

type SystemJobData = { [J in SystemJob as J['name']]: J['data'] };

// One handler per job name; adding a job to systemJobSchema fails typecheck until handled.
const handlers: { [N in keyof SystemJobData]: (data: SystemJobData[N]) => Promise<unknown> } = {
  ping: (data) => Promise.resolve({ pong: data.nonce }),
};

function dispatch<N extends keyof SystemJobData>(
  name: N,
  data: SystemJobData[N],
): Promise<unknown> {
  return handlers[name](data);
}

/**
 * Handles jobs on the `system` queue. Payloads are validated with Zod first; an invalid
 * payload is unrecoverable, so BullMQ does not burn retries on it.
 */
export async function processSystemJob(job: { name: string; data: unknown }): Promise<unknown> {
  const parsed = systemJobSchema.safeParse({ name: job.name, data: job.data });
  if (!parsed.success) {
    throw new UnrecoverableError(`Invalid payload for system job "${job.name}"`);
  }
  return dispatch(parsed.data.name, parsed.data.data);
}
