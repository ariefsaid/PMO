// @e2e-isolation: read-only — seeded demo Admin changes presentation role only; no DB write.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test('AC-AUTH-010: demo Admin can view the Engineer navigation without changing identity', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  const administration = page.getByRole('link', { name: 'Administration' });
  await expect(administration).toBeVisible({ timeout: 15_000 });

  // Open the ONE account menu and choose the view-only Engineer role (AC-ACCT-004).
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitemradio', { name: 'Engineer' }).click();

  await expect(administration).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'My Tasks' })).toBeVisible();
  // The account identity stays real; the separate banner identifies the preview.
  await expect(page.getByRole('button', { name: /account menu/i })).toContainText('Admin');
  await expect(page.getByTestId('impersonation-banner')).toContainText('Engineer');

  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: /return to admin/i }).click();
  await expect(administration).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);

  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitemradio', { name: 'Engineer' }).click();

  // Reload resets the presentation role to the real Admin (view-only never persists).
  await page.reload();
  await expect(administration).toBeVisible({ timeout: 15_000 });

  // Sign out through the account menu (goal oracle: return to login).
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
});
