import { expect, test } from '@playwright/test';

// M0 acceptance: services up + app running => a page is served and /api/health reports
// the database, Redis and storage as healthy.

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('InvoiceGuard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('InvoiceGuard');
  await expect(page.getByRole('link', { name: '/api/health' })).toBeVisible();
});

test('readiness endpoint reports every dependency ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  const body = (await res.json()) as {
    status: string;
    checks: Record<string, { status: string }>;
  };
  expect(body.status).toBe('ok');
  expect(Object.keys(body.checks).sort()).toEqual(['database', 'redis', 'storage']);
  for (const check of Object.values(body.checks)) expect(check.status).toBe('ok');
});

test('liveness endpoint answers without touching dependencies', async ({ request }) => {
  const res = await request.get('/api/health/live');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});
