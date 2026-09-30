import type { TestProject } from 'vitest/node';
import './provided-context';
import { resolveMode, startTestInfra, type RunningTestInfra } from './test-infra';

let running: RunningTestInfra | undefined;

/** Starts Postgres (bootstrapped + migrated), Redis and, with Docker, S3 once per run. */
export async function setup(project: TestProject): Promise<void> {
  const mode = await resolveMode();
  const started = Date.now();
  try {
    running = await startTestInfra(mode, (step) => {
      console.info(`[test-infra] ${step}`);
    });
  } catch (err) {
    // Some libraries reject with non-Error values; Vitest then reports "Unknown Error".
    const message = `test infra (${mode}) failed: ${describeError(err)}`;
    if (process.env.GITHUB_ACTIONS === 'true') {
      // Surfaces as a public annotation on the CI run.
      console.info(`::error title=test-infra::${message.replace(/\r?\n/g, '%0A')}`);
    }
    throw new Error(message, { cause: err });
  }
  console.info(
    `[test-infra] mode=${mode} ready in ${String(Date.now() - started)}ms` +
      (mode === 'native' ? ' (no S3 server: S3 integration tests are skipped; CI runs them)' : ''),
  );
  project.provide('testInfra', running.infra);
}

export async function teardown(): Promise<void> {
  await running?.stop();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (err === undefined) return 'rejected with undefined (no error details)';
  try {
    return JSON.stringify(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}
