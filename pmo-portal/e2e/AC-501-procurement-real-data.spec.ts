import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-501 PM sees real seeded procurement with joined project name', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page.getByText('Workstations & AV')).toBeVisible();
  await expect(page.getByText('Innovate Corp HQ Fit-Out').first()).toBeVisible();
});

test('AC-503 Active Orders includes the Ordered row and excludes Vendor Quoted', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /Active Orders/ }).click();
  // "Network Infrastructure" is status Ordered — should appear
  await expect(page.getByText('Network Infrastructure')).toBeVisible();
  // "Workstations & AV" is Vendor Quoted — must NOT appear in Active Orders
  await expect(page.getByText('Workstations & AV')).toHaveCount(0);
});

test('AC-504 search filters real rows', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /^All/ }).click();
  await page.getByPlaceholder(/Search procurements/i).fill('Workstations');
  await expect(page.getByText('Workstations & AV')).toBeVisible();
  await page.getByPlaceholder(/Search procurements/i).fill('zzz');
  await expect(page.getByText(/No requests found/i)).toBeVisible();
});
