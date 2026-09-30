import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const isCI = process.env.CI !== undefined;

/**
 * E2E tests expect backing services to be running (`pnpm services:docker` or
 * `pnpm services:native`) and a migrated database. The web server is started here: a
 * production build in CI, the dev server locally (reused if already running).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: isCI ? 'pnpm start' : 'pnpm dev',
    url: `http://localhost:${String(PORT)}/api/health/live`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
