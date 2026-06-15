import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-401 — real-DB→real-UI smoke: a real session surfaces real seeded project rows.
test('AC-401 PM sees real seeded projects with joined client + PM names', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  await expect(page.locator('span, div, td').filter({ hasText: 'Innovate Corp' }).first()).toBeVisible();
  await expect(page.locator('span, div, td').filter({ hasText: 'Diego Salvatierra' }).first()).toBeVisible();
});
