import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
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
  if (process.platform === 'win32') return startWithPgCtl(options);
  await server.start();
  return {
    host: 'localhost',
    port: options.port,
    stop: () => server.stop(),
  };
}

/**
 * Windows: postgres.exe refuses to run under an administrator account (GitHub's Windows
 * runners, and developers who are local admins). embedded-postgres spawns postgres.exe
 * directly; pg_ctl instead starts it with a restricted token, which works for admins and
 * non-admins alike.
 */
async function startWithPgCtl(options: NativePostgresOptions): Promise<NativePostgres> {
  // Windows-only optional dependency: a variable specifier keeps typecheck working on
  // Linux/macOS where the package is not installed.
  const specifier = '@embedded-postgres/windows-x64';
  const binaries: unknown = await import(specifier);
  if (typeof binaries !== 'object' || binaries === null || !('pg_ctl' in binaries)) {
    throw new Error(`${specifier} does not export pg_ctl`);
  }
  const pg_ctl = String(binaries.pg_ctl);
  const logFile = join(options.dataDir, 'server.log');
  const serverOptions = `-p ${String(options.port)} -c listen_addresses=localhost`;
  await run(pg_ctl, [
    'start',
    '-D',
    options.dataDir,
    '-l',
    logFile,
    '-o',
    serverOptions,
    '-w',
    '-t',
    '60',
  ]);
  return {
    host: 'localhost',
    port: options.port,
    stop: async () => {
      await run(pg_ctl, ['stop', '-D', options.dataDir, '-m', 'fast', '-w']);
      if (!options.persistent) await rm(options.dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Waits for the exit code only. stdio is ignored on purpose: the server started by
 * `pg_ctl start` inherits pg_ctl's handles, so waiting for piped output to close would hang
 * forever. Failure details are in the server log file.
 */
function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_ctl ${args[0] ?? ''} exited with code ${String(code)}`));
    });
  });
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
