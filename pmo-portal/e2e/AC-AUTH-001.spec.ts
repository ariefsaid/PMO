import { test, expect } from '@playwright/test';

// AC-AUTH-001 — Unauthenticated user is redirected to /login (FR-AUTH-031)
test('unauthenticated visit to / redirects to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});
