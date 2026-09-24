// @e2e-isolation: read-only — seeded Finance account reads the shell without changing data.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test('AC-AUTH-011: a non-Admin has no view-as-role control on desktop or mobile', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await expect(page.getByTestId('desktop-account-cluster').getByRole('button', { name: /view as role/i })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /account menu/i }).click();
  await expect(page.getByTestId('mobile-account-menu')).not.toContainText('View as role');
});
