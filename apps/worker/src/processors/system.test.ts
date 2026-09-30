import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { processSystemJob } from './system';

describe('processSystemJob', () => {
  it('answers ping with the nonce', async () => {
    await expect(processSystemJob({ name: 'ping', data: { nonce: 'abc' } })).resolves.toEqual({
      pong: 'abc',
    });
  });

  it('rejects unknown job names as unrecoverable', async () => {
    await expect(processSystemJob({ name: 'drop-tables', data: {} })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('rejects malformed payloads as unrecoverable', async () => {
    await expect(processSystemJob({ name: 'ping', data: { nonce: 42 } })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
