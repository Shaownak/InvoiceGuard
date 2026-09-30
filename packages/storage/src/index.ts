import type { StorageEnv } from '@invoiceguard/shared/env';
import { findWorkspaceRoot } from '@invoiceguard/shared/env-file';
import { createFsStorage } from './fs-storage';
import { createS3Storage, type S3Storage } from './s3-storage';
import type { ObjectStorage } from './types';

export { assertValidKey } from './keys';
export { createFsStorage } from './fs-storage';
export { createS3Storage, type S3Storage, type S3StorageConfig } from './s3-storage';
export type { ObjectStorage, StorageDriver } from './types';

/**
 * Builds the storage driver selected by STORAGE_DRIVER. A relative STORAGE_FS_ROOT resolves
 * against the workspace root, so web and worker (different cwds) share one directory.
 */
export function createStorage(env: StorageEnv): ObjectStorage {
  if (env.STORAGE_DRIVER === 's3') return createS3StorageFromEnv(env);
  const base = findWorkspaceRoot(process.cwd()) ?? process.cwd();
  return createFsStorage(env.STORAGE_FS_ROOT, base);
}

export function createS3StorageFromEnv(
  env: Extract<StorageEnv, { STORAGE_DRIVER: 's3' }>,
): S3Storage {
  return createS3Storage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
