import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walks up from `start` to the directory holding pnpm-workspace.yaml. */
export function findWorkspaceRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Loads the workspace-root `.env` into process.env if it exists. Variables already set in the
 * real environment win, so CI and production (which have no .env file) are unaffected.
 * Returns the path that was loaded, or null.
 */
export function loadWorkspaceEnvFile(start: string = process.cwd()): string | null {
  const root = findWorkspaceRoot(start);
  if (root === null) return null;
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}
