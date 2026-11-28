// @e2e-isolation: self-isolated — fixture owns its role users, project and work orders.
import { expect } from '@playwright/test';
import { signInJourneyActor } from './support/seedSession';
import { test } from './support/workOrderChecksFixture';

test('AC-RR-001 engineer captures a Draft work order', async ({ page, checksFixture }) => {
  const { run, owners, projectId } = checksFixture;
  await signInJourneyActor(page, owners[0].user.email, owners[0].user.password);
  await page.goto(`/projects/${projectId}/orders`);
  await page.getByRole('button', { name: 'New work order' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Client reference').fill(`${run}/ENG/1`);
  await form.getByLabel(/^Title/).fill(`${run} engineering draft`);
  await form.getByTestId('wo-order-value').fill('1000');
  await form.getByTestId('wo-tax-treatment').selectOption('exclusive');
  await form.getByTestId('wo-tax-amount').fill('0');
  await form.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByText(`Client PO ${run}/ENG/1`)).toBeVisible();
});
