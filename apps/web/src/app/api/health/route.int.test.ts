import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { closeRuntime } from '@/server/runtime';
import { GET } from './route';

const infra = inject('testInfra');

interface Body {
  status: string;
  checks: Record<string, { status: string; latencyMs: number }>;
}

describe('GET /api/health against real dependencies', () => {
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'ig-health-'));
  });

  afterEach(async () => {
    await closeRuntime();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  function stubEnv(overrides: Record<string, string> = {}): void {
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: infra.postgres.appUrl,
      REDIS_URL: infra.redisUrl,
      STORAGE_DRIVER: 'fs',
      STORAGE_FS_ROOT: storageRoot,
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      EMAIL_FROM: 'InvoiceGuard <no-reply@invoiceguard.test>',
      EMAIL_TRANSPORT: 'file',
      EMAIL_FILE_DIR: storageRoot,
      ...overrides,
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  }

  it('returns 200 with database, redis and storage all ok', async () => {
    stubEnv();
    const res = await GET();
    const body = (await res.json()) as Body;
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.status).toBe('ok');
    expect(Object.keys(body.checks).sort()).toEqual(['database', 'redis', 'storage']);
    for (const check of Object.values(body.checks)) expect(check.status).toBe('ok');
  });

  it.skipIf(infra.s3 === null)('returns 200 with the s3 storage driver', async () => {
    if (infra.s3 === null) return;
    stubEnv({
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: infra.s3.endpoint,
      S3_REGION: infra.s3.region,
      S3_BUCKET: infra.s3.bucket,
      S3_ACCESS_KEY_ID: infra.s3.accessKeyId,
      S3_SECRET_ACCESS_KEY: infra.s3.secretAccessKey,
      S3_FORCE_PATH_STYLE: 'true',
    });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns 503 naming redis when Redis is unreachable', async () => {
    stubEnv({ REDIS_URL: 'redis://127.0.0.1:1' });
    const res = await GET();
    const body = (await res.json()) as Body;
    expect(res.status).toBe(503);
    expect(body.status).toBe('unavailable');
    expect(body.checks.redis?.status).toBe('fail');
    expect(body.checks.database?.status).toBe('ok');
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
  });

  it('returns 503 naming the database when Postgres rejects the credentials', async () => {
    const wrong = new URL(infra.postgres.appUrl);
    wrong.password = 'wrong-password';
    stubEnv({ DATABASE_URL: wrong.toString() });
    const res = await GET();
    const body = (await res.json()) as Body;
    expect(res.status).toBe(503);
    expect(body.checks.database?.status).toBe('fail');
    expect(JSON.stringify(body)).not.toContain('wrong-password');
  });

  it('returns a generic 500 when configuration is invalid', async () => {
    stubEnv({ DATABASE_URL: 'not-a-url' });
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'config_invalid', message: 'An unexpected error occurred' },
    });
  });
});
