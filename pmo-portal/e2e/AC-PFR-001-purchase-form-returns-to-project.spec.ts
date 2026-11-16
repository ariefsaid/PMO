// @e2e-isolation: read-only — opens the new-purchase form and cancels; nothing is saved.
/** AC-PFR-001 — goal: an Engineer who starts a new purchase from a project and cancels is back on that project, not on a Procurement page. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

const PROJECT_ID = '41000000-0000-0000-0000-000000000001';

test('AC-PFR-001: cancelling a purchase started from a project returns to that project', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/projects/${PROJECT_ID}/procurement`);
  await page.getByRole('button', { name: 'New procurement' }).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/new\\?project=${PROJECT_ID}`));

  await page.getByRole('button', { name: /^cancel$/i }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_ID}/procurement$`), { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'New procurement' })).toBeVisible();
});
