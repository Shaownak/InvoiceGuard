import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@invoiceguard/db/migrate';
import { freePort, startNativePostgres, startNativeRedis } from './native-services';
import { DATABASE_NAME, bootstrapPostgres, postgresUrl } from './postgres-bootstrap';
import type { TestInfra } from './provided-context';

export type { TestInfra };
export type TestInfraMode = TestInfra['mode'];

// Throwaway credentials for ephemeral test clusters that listen on localhost only.
const ADMIN_PASSWORD = 'test_admin_pw';
const OWNER_PASSWORD = 'test_owner_pw';
const APP_PASSWORD = 'test_app_pw';

export const POSTGRES_IMAGE = 'postgres:16.15-alpine';
export const REDIS_IMAGE = 'redis:8.4.7-alpine';
export const S3_IMAGE = 'rustfs/rustfs:1.0.0';

export interface RunningTestInfra {
  infra: TestInfra;
  stop(): Promise<void>;
}

/**
 * Chooses docker (Testcontainers) or native services. IG_TEST_INFRA=docker|native forces a
 * mode; the default `auto` uses Docker when a container runtime is reachable.
 */
export async function resolveMode(
  requested = process.env.IG_TEST_INFRA ?? 'auto',
): Promise<TestInfraMode> {
  if (requested === 'docker' || requested === 'native') return requested;
  if (requested !== 'auto') throw new Error(`IG_TEST_INFRA must be docker, native, or auto`);
  try {
    const { getContainerRuntimeClient } = await import('testcontainers');
    await getContainerRuntimeClient();
    return 'docker';
  } catch {
    return 'native';
  }
}

export type StepLogger = (step: string) => void;

/** Runs `fn`, labelling any failure (including non-Error rejections) with the step name. */
async function step<T>(name: string, log: StepLogger, fn: () => Promise<T>): Promise<T> {
  log(name);
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err ?? null);
    throw new Error(`${name} failed: ${detail}`, { cause: err });
  }
}

export async function startTestInfra(
  mode: TestInfraMode,
  log: StepLogger = () => undefined,
): Promise<RunningTestInfra> {
  const running = mode === 'docker' ? await startDocker() : await startNative(log);
  const { postgres } = running.infra;
  await step('bootstrap roles', log, () =>
    bootstrapPostgres({
      adminUrl: postgres.adminUrl,
      ownerPassword: OWNER_PASSWORD,
      appPassword: APP_PASSWORD,
    }),
  );
  await step('run migrations', log, () => runMigrations(postgres.ownerUrl));
  return running;
}

function urls(host: string, port: number): TestInfra['postgres'] {
  return {
    host,
    port,
    adminUrl: postgresUrl({ host, port }, 'postgres', ADMIN_PASSWORD, 'postgres'),
    ownerUrl: postgresUrl({ host, port }, 'ig_owner', OWNER_PASSWORD, DATABASE_NAME),
    appUrl: postgresUrl({ host, port }, 'ig_app', APP_PASSWORD, DATABASE_NAME),
  };
}

async function startNative(log: StepLogger): Promise<RunningTestInfra> {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'ig-test-pg-')), 'data');
  const [pgPort, redisPort] = [await freePort(), await freePort()];
  // Keep recent server output: embedded-postgres rejects without details when initdb fails.
  const pgLog: string[] = [];
  const postgres = await step('start native postgres', log, async () => {
    try {
      return await startNativePostgres({
        dataDir,
        port: pgPort,
        adminUser: 'postgres',
        adminPassword: ADMIN_PASSWORD,
        persistent: false,
        onLog: (line) => {
          pgLog.push(line.trim());
          if (pgLog.length > 30) pgLog.shift();
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : JSON.stringify(err ?? null);
      throw new Error(`${detail}; postgres output:\n${pgLog.join('\n')}`, { cause: err });
    }
  });
  const redis = await step('start native redis', log, () => startNativeRedis(redisPort));
  return {
    infra: {
      mode: 'native',
      postgres: urls(postgres.host, postgres.port),
      redisUrl: `redis://${redis.host}:${String(redis.port)}`,
      s3: null,
    },
    async stop() {
      await Promise.allSettled([postgres.stop(), redis.stop()]);
    },
  };
}

async function startDocker(): Promise<RunningTestInfra> {
  const { GenericContainer, Wait } = await import('testcontainers');
  const s3Credentials = { accessKeyId: 'testaccess', secretAccessKey: 'testsecret123' };

  const [postgres, redis, s3] = await Promise.all([
    new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: ADMIN_PASSWORD })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start(),
    new GenericContainer(REDIS_IMAGE)
      .withCommand(['redis-server', '--maxmemory-policy', 'noeviction'])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer(S3_IMAGE)
      .withEnvironment({
        RUSTFS_VOLUMES: '/data',
        RUSTFS_ADDRESS: '0.0.0.0:9000',
        RUSTFS_ACCESS_KEY: s3Credentials.accessKeyId,
        RUSTFS_SECRET_KEY: s3Credentials.secretAccessKey,
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/health', 9000).forStatusCode(200))
      .start(),
  ]);

  const s3Config: NonNullable<TestInfra['s3']> = {
    bucket: 'invoiceguard-test',
    region: 'us-east-1',
    endpoint: `http://${s3.getHost()}:${String(s3.getMappedPort(9000))}`,
    forcePathStyle: true,
    ...s3Credentials,
  };
  const { createS3Storage } = await import('@invoiceguard/storage');
  await createS3Storage(s3Config).ensureBucket();

  return {
    infra: {
      mode: 'docker',
      postgres: urls(postgres.getHost(), postgres.getMappedPort(5432)),
      redisUrl: `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`,
      s3: s3Config,
    },
    async stop() {
      await Promise.allSettled([postgres.stop(), redis.stop(), s3.stop()]);
    },
  };
}
