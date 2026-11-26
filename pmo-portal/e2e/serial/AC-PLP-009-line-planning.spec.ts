// @e2e-isolation: serial - creates a request; line planning is on for every organisation (#2746), so no setting is flipped.
import { test, expect } from '@playwright/test';
import { login } from '../helpers';

// AC-PLP-009 (#2696) - a requester gives a request line a category and a needed-by date, and the request's line list shows both.
// Line planning is on for every organisation with two starter categories (#2746).
//
// Written for the orchestrator's wave run; not executed by the builder (no database in the builder's gate).

test('AC-PLP-009 line planning is on for everyone (#2746) with starter categories, and a line carries a category and a date', async ({ page }) => {
  await login(page, 'admin@acme.test');
  await page.goto('/administration/accounting');
  await expect(page.getByTestId('line-category-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Project', { exact: true })).toBeVisible();

  await page.goto('/procurement/new?have=need');
  await page.getByLabel(/title/i).fill('Line planning journey');
  await page.getByLabel('New item description').fill('Cable');
  await page.getByLabel('New item quantity').fill('2');
  await page.getByLabel('New item unit price').fill('10');
  await page.getByRole('button', { name: 'Add line item' }).click();
  await page.getByLabel('Line category').selectOption({ label: 'Project' });
  await page.getByRole('textbox', { name: 'Needed by' }).fill('2026-12-31');
  await page.getByRole('button', { name: 'Save draft' }).click();

  await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await page.getByRole('tab', { name: /line items/i }).click();
  const panel = page.getByTestId('line-plan-panel');
  await expect(panel.getByLabel('Line category')).toHaveValue(/.+/);
  await expect(panel.getByRole('textbox', { name: 'Needed by' })).toHaveValue('31 Dec 2026');
});
