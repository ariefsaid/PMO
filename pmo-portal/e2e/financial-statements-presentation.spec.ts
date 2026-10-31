// @e2e-isolation: read-only — uses the seeded Finance and project records and scoped statement RPC fixtures; it performs no writes or native calls.
/**
 * Phase 2 (#1529): the responsive "project totals fit" geometry cases moved to the /projects/:id
 * layout sweep (e2e/layout/project-detail.layout.spec.ts); the fixtures they shared now live in
 * e2e/support/financial-statement-fixtures.ts. This file keeps the DOWN lane's remaining
 * MOVE-COMPONENT row until that lane moves it below the browser.
 */
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import { STATEMENT_PROJECT_ID as PROJECT_ID, installRoutes, forceLocale } from './support/financial-statement-fixtures';

test('AC-008 support: project Retry repeats the eligible totals read without dropping its saved values', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const routes = await installRoutes(page, { projectId: PROJECT_ID, mode: 'delayed' });
  await forceLocale(page, 'en');
  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${PROJECT_ID}/overview`);
  await expect(page.getByRole('heading', { level: 2, name: 'Project profit and loss' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const readsBeforeRetry = routes.readCount();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(routes.readCount).toBe(readsBeforeRetry + 1);
  await expect(page.getByText('12,345,678,901,234,567,890.01')).toBeVisible();
  // PD-B: the project context line is currency + the period shown (no capture window).
  await expect(page.getByText(/Current period:/)).toBeVisible();
});
