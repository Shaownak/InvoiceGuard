import { describe, expect, it } from 'vitest';
import { ConfigError } from './errors';
import { migrateEnvSchema, parseEnv, webEnvSchema, workerEnvSchema } from './env';

const validWebFs = {
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://ig_app:pw@localhost:5432/invoiceguard',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_DRIVER: 'fs',
  STORAGE_FS_ROOT: '.local/storage',
  SESSION_SECRET: 'x'.repeat(32),
  EMAIL_FROM: 'InvoiceGuard <no-reply@invoiceguard.test>',
  EMAIL_TRANSPORT: 'file',
  EMAIL_FILE_DIR: '.local/mail',
};

const s3Vars = {
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'invoiceguard-dev',
  S3_ACCESS_KEY_ID: 'dev-access-key',
  S3_SECRET_ACCESS_KEY: 'super-secret-value-123',
};

function configError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

describe('parseEnv', () => {
  it('accepts a valid fs-storage web env and applies defaults', () => {
    const env = parseEnv(webEnvSchema, validWebFs);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.STORAGE_DRIVER).toBe('fs');
  });

  it('accepts s3 storage and parses S3_FORCE_PATH_STYLE as a boolean', () => {
    const env = parseEnv(webEnvSchema, {
      ...validWebFs,
      STORAGE_FS_ROOT: undefined,
      ...s3Vars,
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(env.STORAGE_DRIVER).toBe('s3');
    if (env.STORAGE_DRIVER === 's3') expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('requires S3 settings only when the s3 driver is selected', () => {
    const err = configError(() => parseEnv(webEnvSchema, { ...validWebFs, STORAGE_DRIVER: 's3' }));
    expect(err.message).toContain('S3_BUCKET: is required');
    expect(err.message).toContain('S3_SECRET_ACCESS_KEY: is required');
    expect(err.message).not.toContain('STORAGE_FS_ROOT');
  });

  it('treats empty strings as unset', () => {
    const err = configError(() => parseEnv(webEnvSchema, { ...validWebFs, DATABASE_URL: '' }));
    expect(err.message).toContain('DATABASE_URL: is required');
  });

  it('rejects a non-postgres database URL', () => {
    const err = configError(() =>
      parseEnv(webEnvSchema, { ...validWebFs, DATABASE_URL: 'mysql://localhost/db' }),
    );
    expect(err.message).toContain('DATABASE_URL');
  });

  it('rejects an unknown storage driver', () => {
    const err = configError(() => parseEnv(webEnvSchema, { ...validWebFs, STORAGE_DRIVER: 'ftp' }));
    expect(err.message).toContain('STORAGE_DRIVER');
  });

  it('forbids the fs storage driver in production', () => {
    const err = configError(() =>
      parseEnv(webEnvSchema, { ...validWebFs, NODE_ENV: 'production' }),
    );
    expect(err.message).toContain('STORAGE_DRIVER: the fs driver is for local development only');
  });

  it('requires a session secret of at least 32 characters', () => {
    expect(
      configError(() => parseEnv(webEnvSchema, { ...validWebFs, SESSION_SECRET: undefined }))
        .message,
    ).toContain('SESSION_SECRET: is required');
    const err = configError(() =>
      parseEnv(webEnvSchema, { ...validWebFs, SESSION_SECRET: 'short-secret-value' }),
    );
    expect(err.message).toContain('SESSION_SECRET: must be at least 32 characters');
    expect(err.message).not.toContain('short-secret-value');
  });

  it('requires SMTP_URL only for the smtp email transport', () => {
    const err = configError(() =>
      parseEnv(webEnvSchema, { ...validWebFs, EMAIL_TRANSPORT: 'smtp' }),
    );
    expect(err.message).toContain('SMTP_URL: is required');
    expect(err.message).not.toContain('EMAIL_FILE_DIR');
    const env = parseEnv(webEnvSchema, {
      ...validWebFs,
      EMAIL_TRANSPORT: 'smtp',
      EMAIL_FILE_DIR: undefined,
      SMTP_URL: 'smtp://localhost:1025',
    });
    expect(env.EMAIL_TRANSPORT).toBe('smtp');
    expect(() =>
      parseEnv(webEnvSchema, {
        ...validWebFs,
        EMAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'http://localhost:1025',
      }),
    ).toThrow(/SMTP_URL/);
  });

  it('forbids the file email transport in production', () => {
    const err = configError(() =>
      parseEnv(webEnvSchema, {
        ...validWebFs,
        ...s3Vars,
        STORAGE_FS_ROOT: undefined,
        NODE_ENV: 'production',
      }),
    );
    expect(err.message).toContain(
      'EMAIL_TRANSPORT: the file transport is for local development only',
    );
    expect(err.message).not.toContain('STORAGE_DRIVER');
  });

  it('parses TRUST_PROXY_HEADERS as a boolean defaulting to false', () => {
    expect(parseEnv(webEnvSchema, validWebFs).TRUST_PROXY_HEADERS).toBe(false);
    expect(
      parseEnv(webEnvSchema, { ...validWebFs, TRUST_PROXY_HEADERS: 'true' }).TRUST_PROXY_HEADERS,
    ).toBe(true);
  });

  it('never includes variable values in the error message', () => {
    const err = configError(() =>
      parseEnv(webEnvSchema, {
        ...s3Vars,
        DATABASE_URL: 'postgres://ig_app:hunter2-secret@localhost/x',
        S3_BUCKET: 'Invalid_Bucket!',
        LOG_LEVEL: 'loud-secret-level',
      }),
    );
    for (const value of [
      'super-secret-value-123',
      'hunter2-secret',
      'Invalid_Bucket!',
      'loud-secret-level',
    ]) {
      expect(err.message).not.toContain(value);
      expect(JSON.stringify(err.details)).not.toContain(value);
    }
    expect(err.message).toContain('APP_URL: is required');
    expect(err.message).toContain('S3_BUCKET');
    expect(err.message).toContain('LOG_LEVEL');
  });

  it('lets each process require only its own variables', () => {
    expect(() =>
      parseEnv(migrateEnvSchema, { DATABASE_OWNER_URL: 'postgres://o:p@localhost/db' }),
    ).not.toThrow();
    const worker = parseEnv(workerEnvSchema, { ...validWebFs, APP_URL: undefined });
    expect(worker.WORKER_CONCURRENCY).toBe(4);
  });
});
