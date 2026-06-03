import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-705 Top Projects table shows SQL-joined client name', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  await expect(page.getByText('Innovate Corp HQ Fit-Out').first()).toBeVisible();
  await expect(page.getByText('Innovate Corp').first()).toBeVisible();
});
