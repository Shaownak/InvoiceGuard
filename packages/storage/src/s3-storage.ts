import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { NotFoundError } from '@invoiceguard/shared/errors';
import { assertValidKey } from './keys';
import type { ObjectStorage } from './types';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface S3Storage extends ObjectStorage {
  /** Creates the bucket if it does not exist. For local and test setups only. */
  ensureBucket(): Promise<void>;
}

export function createS3Storage(config: S3StorageConfig, client?: S3Client): S3Storage {
  const s3 =
    client ??
    new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 2,
    });
  const Bucket = config.bucket;

  return {
    driver: 's3',

    async ping() {
      await s3.send(new HeadBucketCommand({ Bucket }));
    },

    async ensureBucket() {
      try {
        await s3.send(new HeadBucketCommand({ Bucket }));
      } catch (err) {
        if (!isNotFound(err)) throw err;
        await s3.send(new CreateBucketCommand({ Bucket }));
      }
    },

    async put(key, body, options) {
      assertValidKey(key);
      await s3.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: options.contentType }),
      );
    },

    async get(key) {
      assertValidKey(key);
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        if (res.Body === undefined) throw new NotFoundError('Object not found');
        return await res.Body.transformToByteArray();
      } catch (err) {
        if (isNotFound(err)) throw new NotFoundError('Object not found');
        throw err;
      }
    },

    async delete(key) {
      assertValidKey(key);
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey || err instanceof NotFound) return true;
  return err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404;
}
