import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-AUTH-010 — Admin sees impersonation and can view as a role, client-side (FR-AUTH-033/034/035)
test('Admin can view as Engineer; identity is unchanged', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  const sidebar = page.locator('aside');

  // Admin starts with full nav (incl. Administration + Sales Pipeline).
  await expect(sidebar.getByRole('link', { name: 'Administration' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Sales Pipeline' })).toBeVisible();

  // Open "View as role" and pick Engineer.
  await page.getByRole('button', { name: /view as role/i }).click();
  await page.getByRole('menuitem', { name: 'Engineer' }).click();

  // Nav collapses to the Engineer set.
  await expect(sidebar.getByRole('link', { name: 'Tasks' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Sales Pipeline' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Administration' })).toHaveCount(0);

  // Identity unchanged: sign-out still works and lands on /login.
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
});
