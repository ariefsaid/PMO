// @e2e-isolation: read-only — seeded Finance account reads the shell without changing data.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test('AC-AUTH-011: a non-Admin has no view-as-role control on desktop or mobile', async ({ page }) => {
  await signIn(page, 'finance@acme.test');

  // Desktop: the ONE account menu has no View-as-role section/choices.
  await page.getByRole('button', { name: /account menu/i }).click();
  await expect(page.getByRole('menu')).not.toContainText('View as role');
  await page.keyboard.press('Escape');

  // 390px phone viewport: the same shared menu still has no View-as-role section.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /account menu/i }).click();
  await expect(page.getByRole('menu')).not.toContainText('View as role');
});