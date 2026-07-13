// @e2e-isolation: read-only — sign-in + sign-out + nav assertion; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-AUTH-006 — Sign-out returns to /login (FR-AUTH-023)
test('sign-out returns to /login and blocks re-entry', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
