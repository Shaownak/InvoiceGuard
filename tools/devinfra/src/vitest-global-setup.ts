import type { TestProject } from 'vitest/node';
import './provided-context';
import { resolveMode, startTestInfra, type RunningTestInfra } from './test-infra';

let running: RunningTestInfra | undefined;

/** Starts Postgres (bootstrapped + migrated), Redis and, with Docker, S3 once per run. */
export async function setup(project: TestProject): Promise<void> {
  const mode = await resolveMode();
  const started = Date.now();
  running = await startTestInfra(mode);
  console.info(
    `[test-infra] mode=${mode} ready in ${String(Date.now() - started)}ms` +
      (mode === 'native' ? ' (no S3 server: S3 integration tests are skipped; CI runs them)' : ''),
  );
  project.provide('testInfra', running.infra);
}

export async function teardown(): Promise<void> {
  await running?.stop();
}
