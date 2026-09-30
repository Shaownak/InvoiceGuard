import { NotFoundError } from '@invoiceguard/shared/errors';
import { describe, expect, inject, it } from 'vitest';
import { createS3Storage } from './s3-storage';

const { s3 } = inject('testInfra');

// Needs an S3-compatible server, which only the Docker test infra provides. CI runs this;
// native mode (no Docker) skips it and says so in the test-infra banner.
describe.skipIf(s3 === null)('s3 storage (real S3-compatible server)', () => {
  const storage = s3 === null ? null : createS3Storage(s3);

  it('pings the bucket', async () => {
    await expect(storage?.ping()).resolves.toBeUndefined();
  });

  it('round-trips bytes, then deletes idempotently', async () => {
    if (storage === null) return;
    const body = new Uint8Array([37, 80, 68, 70, 0, 255]);
    await storage.put('orgs/test/documents/doc-1', body, { contentType: 'application/pdf' });
    expect(await storage.get('orgs/test/documents/doc-1')).toEqual(body);
    await storage.delete('orgs/test/documents/doc-1');
    await storage.delete('orgs/test/documents/doc-1');
    await expect(storage.get('orgs/test/documents/doc-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('ensureBucket is idempotent', async () => {
    await expect(storage?.ensureBucket()).resolves.toBeUndefined();
  });

  it('fails ping for a missing bucket', async () => {
    if (s3 === null) return;
    await expect(createS3Storage({ ...s3, bucket: 'does-not-exist-ig' }).ping()).rejects.toThrow();
  });
});
