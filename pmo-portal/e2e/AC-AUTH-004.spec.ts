import { test, expect } from '@playwright/test';

// AC-AUTH-004 — Invalid credentials show an error and stay on /login (FR-AUTH-021)
test('invalid credentials show an inline error and stay on /login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('pm@acme.test');
  await page.getByLabel(/password/i).fill('wrongpass');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
