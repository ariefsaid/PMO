// @e2e-isolation: read-only — opens the schedule dialog on the site reports screen and cancels; no write.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-PCP-010 — job 10 of fix/walk-people: "Send this report every …" is reachable on the report.
 *
 * Goal oracle: an Admin on Site reports finds the control, opens it, and is asked who and when, with the report already fixed.
 */
test('AC-PCP-010: an Admin finds "Send this report every …" on the site reports screen and is asked who and when', async ({ page }) => {
  await login(page, 'admin@acme.test');
  await page.goto('/site-reports');
  await page.getByRole('button', { name: /Send this report every/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Email this report on a schedule');
  await expect(dialog.getByLabel('Send time')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save report' })).toBeDisabled();
  await expect(dialog.getByLabel('Report')).toHaveCount(0);
});
