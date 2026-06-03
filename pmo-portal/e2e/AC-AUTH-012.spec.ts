import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-AUTH-012 — Session persists across reload (FR-AUTH-024)
test('session survives a page reload', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Alice Manager')).toBeVisible();
});
