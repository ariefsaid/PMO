import { test, expect } from '@playwright/test';

// AC-AUTH-002 — Protected deep-link blocked when logged out (FR-AUTH-031)
test('deep-link to a project redirects to /login when logged out', async ({ page }) => {
  await page.goto('/projects/40000000-0000-0000-0000-000000000001');
  await expect(page).toHaveURL(/\/login$/);
});
