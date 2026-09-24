// @e2e-isolation: read-only — seeded demo Admin changes presentation role only; no DB write.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test('AC-AUTH-010: demo Admin can view the Engineer navigation without changing identity', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  const desktop = page.getByTestId('desktop-account-cluster');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(nav.getByRole('link', { name: 'Administration' })).toBeVisible();

  await desktop.getByRole('button', { name: /view as role/i }).click();
  await desktop.getByRole('menuitem', { name: 'Engineer' }).click();

  await expect(nav.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'My Tasks' })).toBeVisible();
  await expect(desktop).toContainText('Engineer');

  await page.reload();
  await expect(nav.getByRole('link', { name: 'Administration' })).toBeVisible();
  await expect(desktop.getByRole('button', { name: /view as role/i })).toContainText('Admin');
  await desktop.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
});
