import { parseEnv, storageEnvSchema } from '@invoiceguard/shared/env';
import { loadWorkspaceEnvFile } from '@invoiceguard/shared/env-file';
import { createLogger } from '@invoiceguard/shared/logger';
import { createS3StorageFromEnv, createStorage } from '../index';

// Local/test setup helper: makes sure the configured storage location exists.
loadWorkspaceEnvFile();
const env = parseEnv(storageEnvSchema, process.env);
const log = createLogger({ name: 'storage', level: env.LOG_LEVEL });

try {
  if (env.STORAGE_DRIVER === 'fs') {
    await createStorage(env).ping();
    log.info({ driver: 'fs' }, 'storage directory ready');
  } else {
    await createS3StorageFromEnv(env).ensureBucket();
    log.info({ driver: 's3', bucket: env.S3_BUCKET }, 'bucket ready');
  }
} catch (err) {
  log.error({ err }, 'could not prepare storage');
  process.exitCode = 1;
}
