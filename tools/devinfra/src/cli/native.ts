import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { runMigrations } from '@invoiceguard/db/migrate';
import { parseEnv } from '@invoiceguard/shared/env';
import { findWorkspaceRoot, loadWorkspaceEnvFile } from '@invoiceguard/shared/env-file';
import { createLogger } from '@invoiceguard/shared/logger';
import { bootstrapPostgres } from '../postgres-bootstrap';
import {
  startNativePostgres,
  startNativeRedis,
  type NativePostgres,
  type NativeRedis,
} from '../native-services';

/**
 * Runs Postgres and Redis natively (no Docker) using the ports and credentials from .env,
 * bootstraps roles, applies migrations, and with --dev also runs `pnpm dev`.
 * Data persists in .local/postgres; Redis is in-memory. Ctrl+C stops everything.
 */

const root = findWorkspaceRoot(process.cwd());
if (root === null) throw new Error('Run this inside the InvoiceGuard workspace');
if (loadWorkspaceEnvFile(root) === null) {
  console.error('No .env found. Copy .env.example to .env first:  cp .env.example .env');
  process.exit(1);
}

const localUrl = z
  .url()
  .refine((value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname), {
    message: 'native services only run on localhost',
  });
const env = parseEnv(
  z.object({
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_ADMIN_URL: localUrl,
    DATABASE_OWNER_URL: localUrl,
    DATABASE_URL: localUrl,
    REDIS_URL: localUrl,
    STORAGE_DRIVER: z.enum(['fs', 's3']),
    STORAGE_FS_ROOT: z.string().optional(),
  }),
  process.env,
);
const log = createLogger({ name: 'native-services', level: env.LOG_LEVEL });

const admin = new URL(env.DATABASE_ADMIN_URL);
const owner = new URL(env.DATABASE_OWNER_URL);
const app = new URL(env.DATABASE_URL);
if (owner.username !== 'ig_owner' || app.username !== 'ig_app') {
  throw new Error('DATABASE_OWNER_URL must use role ig_owner and DATABASE_URL role ig_app');
}
if (new Set([admin.port, owner.port, app.port]).size !== 1) {
  throw new Error('DATABASE_ADMIN_URL, DATABASE_OWNER_URL and DATABASE_URL must use the same port');
}
const pgPort = Number(admin.port || 5432);
const redisPort = Number(new URL(env.REDIS_URL).port || 6379);
const withDev = process.argv.includes('--dev');

let postgres: NativePostgres | undefined;
let redis: NativeRedis | undefined;
let child: ChildProcess | undefined;
let stopping = false;

async function shutdown(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info('stopping native services');
  child?.kill();
  await Promise.allSettled([redis?.stop(), postgres?.stop()]);
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  log.info({ port: pgPort }, 'starting Postgres 16 (embedded)');
  postgres = await startNativePostgres({
    dataDir: join(root, '.local', 'postgres'),
    port: pgPort,
    adminUser: decodeURIComponent(admin.username),
    adminPassword: decodeURIComponent(admin.password),
    persistent: true,
  });
  await bootstrapPostgres({
    adminUrl: env.DATABASE_ADMIN_URL,
    ownerPassword: decodeURIComponent(owner.password),
    appPassword: decodeURIComponent(app.password),
    database: owner.pathname.slice(1),
  });

  log.info({ port: redisPort }, 'starting Redis-compatible server');
  redis = await startNativeRedis(redisPort);

  if (env.STORAGE_DRIVER === 'fs' && env.STORAGE_FS_ROOT !== undefined) {
    await mkdir(join(root, env.STORAGE_FS_ROOT), { recursive: true });
  } else if (env.STORAGE_DRIVER === 's3') {
    log.warn('STORAGE_DRIVER=s3 but native mode runs no S3 server; set STORAGE_DRIVER=fs in .env');
  }

  const migrations = await runMigrations(env.DATABASE_OWNER_URL);
  log.info(migrations, 'migrations up to date');
  log.info('native services ready (Ctrl+C to stop)');

  if (withDev) {
    // A single command string (no args array): shell mode is needed on Windows for pnpm.cmd.
    child = spawn('pnpm dev', { cwd: root, stdio: 'inherit', shell: true });
    child.on('exit', (code) => void shutdown(code ?? 0));
  }
} catch (err) {
  log.error({ err }, 'failed to start native services (is the port already in use?)');
  await shutdown(1);
}
