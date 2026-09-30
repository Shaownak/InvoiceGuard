import { randomUUID } from 'node:crypto';
import { access, constants, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { NotFoundError } from '@invoiceguard/shared/errors';
import { assertValidKey } from './keys';
import type { ObjectStorage } from './types';

/**
 * Filesystem-backed storage for local development without Docker. Rejected in production by
 * env validation. Writes go to a temp file and are renamed so readers never see partial files.
 */
export function createFsStorage(root: string, cwd: string = process.cwd()): ObjectStorage {
  const absoluteRoot = isAbsolute(root) ? root : resolve(cwd, root);

  function pathFor(key: string): string {
    assertValidKey(key);
    const full = join(absoluteRoot, ...key.split('/'));
    // Defense in depth: assertValidKey already forbids traversal segments.
    if (!full.startsWith(absoluteRoot + sep)) throw new Error('Storage key escaped the root');
    return full;
  }

  return {
    driver: 'fs',

    async ping() {
      await mkdir(absoluteRoot, { recursive: true });
      await access(absoluteRoot, constants.R_OK | constants.W_OK);
    },

    async put(key, body) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, body);
      await rename(temp, target);
    },

    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (err) {
        if (isErrnoException(err) && err.code === 'ENOENT')
          throw new NotFoundError('Object not found');
        throw err;
      }
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
