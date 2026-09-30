import { NoSuchKey, NotFound, type S3Client } from '@aws-sdk/client-s3';
import { NotFoundError, ValidationError } from '@invoiceguard/shared/errors';
import { describe, expect, it, vi } from 'vitest';
import { createS3Storage } from './s3-storage';

const config = {
  bucket: 'test-bucket',
  region: 'us-east-1',
  accessKeyId: 'a',
  secretAccessKey: 'b',
  forcePathStyle: true,
};

function stubClient(send: (command: { constructor: { name: string } }) => unknown): S3Client {
  // Only `send` is used by the storage wrapper.
  return { send: vi.fn(send) } as unknown as S3Client;
}

describe('s3 storage (stubbed client)', () => {
  it('maps NoSuchKey to NotFoundError', async () => {
    const client = stubClient(() => {
      throw new NoSuchKey({ message: 'missing', $metadata: { httpStatusCode: 404 } });
    });
    await expect(createS3Storage(config, client).get('k')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('creates the bucket only when HeadBucket reports it missing', async () => {
    const calls: string[] = [];
    const client = stubClient((command) => {
      calls.push(command.constructor.name);
      if (command.constructor.name === 'HeadBucketCommand') {
        throw new NotFound({ message: 'no bucket', $metadata: { httpStatusCode: 404 } });
      }
      return {};
    });
    await createS3Storage(config, client).ensureBucket();
    expect(calls).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);
  });

  it('propagates non-404 errors from ensureBucket', async () => {
    const client = stubClient(() => {
      throw new Error('AccessDenied');
    });
    await expect(createS3Storage(config, client).ensureBucket()).rejects.toThrow('AccessDenied');
  });

  it('validates keys before calling S3', async () => {
    const client = stubClient(() => ({}));
    await expect(
      createS3Storage(config, client).put('../x', new Uint8Array(), { contentType: 'text/plain' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(client.send).not.toHaveBeenCalled();
  });
});
