import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-AUTH-003 — Valid password login lands on dashboard with correct role (FR-AUTH-020, FR-AUTH-032)
test('PM password login lands on dashboard with PM nav', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Alice Manager')).toBeVisible();

  const sidebar = page.getByRole('navigation', { name: /primary navigation/i });
  await expect(sidebar.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Sales Pipeline' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Procurement' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Timesheets' })).toBeVisible();
});
