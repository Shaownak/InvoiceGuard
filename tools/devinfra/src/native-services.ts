import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';

/**
 * Native (no Docker) Postgres and Redis. Postgres is the real server binary shipped by
 * `embedded-postgres`; Redis comes from `redis-memory-server` (Memurai on Windows, a source
 * build of Redis elsewhere). See docs/adr/0011-native-dev-services.md.
 */

export interface NativePostgres {
  host: string;
  port: number;
  stop(): Promise<void>;
}

export interface NativePostgresOptions {
  dataDir: string;
  port: number;
  adminUser: string;
  adminPassword: string;
  /** Keep the data directory after stop (dev) or delete it (tests). */
  persistent: boolean;
  onLog?: (line: string) => void;
}

export async function startNativePostgres(options: NativePostgresOptions): Promise<NativePostgres> {
  const server = new EmbeddedPostgres({
    databaseDir: options.dataDir,
    port: options.port,
    user: options.adminUser,
    password: options.adminPassword,
    persistent: options.persistent,
    onLog: (message: unknown) => options.onLog?.(String(message)),
    onError: (message: unknown) => options.onLog?.(String(message)),
  });
  if (!existsSync(join(options.dataDir, 'PG_VERSION'))) {
    await server.initialise();
  }
  await server.start();
  return {
    host: 'localhost',
    port: options.port,
    stop: () => server.stop(),
  };
}

export interface NativeRedis {
  host: string;
  port: number;
  stop(): Promise<void>;
}

export async function startNativeRedis(port: number): Promise<NativeRedis> {
  const server = new RedisMemoryServer({ instance: { port }, autoStart: false });
  await server.start();
  return {
    host: await server.getHost(),
    port: await server.getPort(),
    stop: async () => {
      await server.stop();
    },
  };
}

/** Asks the OS for a free TCP port on localhost. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not allocate a port'));
        return;
      }
      srv.close(() => {
        resolve(address.port);
      });
    });
  });
}
