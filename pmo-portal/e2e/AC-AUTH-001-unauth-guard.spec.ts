// @e2e-isolation: read-only — unauth navigation/assert; no login, no DB writes.
import { test, expect } from '@playwright/test';

// AC-AUTH-001 + AC-AUTH-002 — unauth users are guarded to /login (curated journey).
test('AC-AUTH-001 unauthenticated visit to / redirects to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});

test('AC-AUTH-002 deep-link to a protected route redirects to /login when logged out', async ({ page }) => {
  await page.goto('/projects/40000000-0000-0000-0000-000000000001');
  await expect(page).toHaveURL(/\/login$/);
});
