import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-AUTH-009 — Engineer role hides Administration and restricted nav (FR-AUTH-032)
test('Engineer sees only the Engineer nav set', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  const sidebar = page.locator('aside');

  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Timesheets' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Tasks' })).toBeVisible();

  await expect(sidebar.getByRole('link', { name: 'Sales Pipeline' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Procurement' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Companies' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Administration' })).toHaveCount(0);
});
