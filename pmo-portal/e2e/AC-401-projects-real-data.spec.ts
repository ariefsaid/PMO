import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-401 PM sees real seeded projects with client+PM names', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  await expect(page.getByText('Northwind ERP Rollout')).toBeVisible();
  await expect(page.getByText('Regional Services Program')).toBeVisible();
  // Verify joined client/PM names appear in the cards (not the hidden dropdown option)
  await expect(page.locator('span, div, td').filter({ hasText: 'Innovate Corp' }).first()).toBeVisible();
  await expect(page.locator('span, div, td').filter({ hasText: 'Alice Manager' }).first()).toBeVisible();
});

test('AC-403 Leads tab filters to PQ/Tender pipeline rows', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await page.getByRole('button', { name: /Leads/ }).click();
  await expect(page.getByText('Regional Services Program')).toBeVisible();
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toHaveCount(0);
});

test('AC-404 search filters real rows', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await page.getByPlaceholder(/Search projects/i).fill('Northwind');
  await expect(page.getByText('Northwind ERP Rollout')).toBeVisible();
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toHaveCount(0);
});
