import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-604 Finance (no timesheet) sees the empty state, no crash', async ({ page }) => {
  await login(page, 'finance@acme.test');
  await page.goto('/timesheets');
  await expect(page.getByTestId('timesheets-empty')).toBeVisible();
});
