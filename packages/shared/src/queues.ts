import { z } from 'zod';

/** Queue names shared by producers (web) and consumers (worker). */
export const QUEUES = {
  system: 'system',
} as const;

/** Jobs on the `system` queue. `ping` exists so tests and ops can prove the pipeline works. */
export const systemJobSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('ping'), data: z.object({ nonce: z.string().max(100) }) }),
]);

export type SystemJob = z.infer<typeof systemJobSchema>;

const JOB_KIND = /^[a-z][a-z0-9-]*$/;
const ENTITY_ID = /^[A-Za-z0-9-]+$/;

/**
 * Deterministic BullMQ job id, so enqueueing the same work twice is a no-op (ARCHITECTURE.md
 * section 6). BullMQ rejects ':' in custom ids, so the separator is '.', e.g.
 * `extract.0192f3a4-...`. See docs/adr/0013-job-id-format.md.
 */
export function deterministicJobId(kind: string, entityId: string): string {
  if (!JOB_KIND.test(kind)) throw new Error('Invalid job kind');
  if (!ENTITY_ID.test(entityId)) throw new Error('Invalid job entity id');
  return `${kind}.${entityId}`;
}
