import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundError, ValidationError } from '@invoiceguard/shared/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFsStorage } from './fs-storage';

describe('fs storage', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ig-storage-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips bytes and deletes idempotently', async () => {
    const storage = createFsStorage(root);
    const body = new Uint8Array([0, 1, 2, 250, 255]);
    await storage.put('orgs/a/documents/b', body, { contentType: 'application/pdf' });
    expect(await storage.get('orgs/a/documents/b')).toEqual(body);
    await storage.delete('orgs/a/documents/b');
    await storage.delete('orgs/a/documents/b');
    await expect(storage.get('orgs/a/documents/b')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('overwrites atomically without leaving temp files', async () => {
    const storage = createFsStorage(root);
    await storage.put('k', new Uint8Array([1]), { contentType: 'text/plain' });
    await storage.put('k', new Uint8Array([2]), { contentType: 'text/plain' });
    expect(await storage.get('k')).toEqual(new Uint8Array([2]));
    expect(await readdir(root)).toEqual(['k']);
  });

  it('rejects traversal keys before touching the filesystem', async () => {
    const storage = createFsStorage(join(root, 'inner'));
    await expect(
      storage.put('../escape', new Uint8Array([1]), { contentType: 'text/plain' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });

  it('ping creates the root when missing and succeeds', async () => {
    const nested = join(root, 'not', 'yet');
    await createFsStorage(nested).ping();
    expect(existsSync(nested)).toBe(true);
  });

  it('resolves a relative root against the given cwd', async () => {
    const storage = createFsStorage('relative-root', root);
    await storage.put('x', new Uint8Array([7]), { contentType: 'text/plain' });
    expect(existsSync(join(root, 'relative-root', 'x'))).toBe(true);
  });
});
