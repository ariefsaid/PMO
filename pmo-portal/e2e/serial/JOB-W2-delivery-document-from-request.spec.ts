// @e2e-isolation: serial — sets the org-wide material-request approval chain that every material-request journey reads.
/** JOB-W2 — an approved material request opens its delivery document listing the approved items and quantities.
 *  Partly landed: the delivery document is generated from the request; a printed form with the signatory list (coordinator, requester, carrier, yard security, receiver) does not exist and is not tested. */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { mrqSetup, submittedRequest } from '../support/mrqJobFixture';
import { makeWarehouse, runSuffix } from '../support/stockFixture';

test.setTimeout(150_000);

test('JOB-W2 the approved request opens a delivery document with its items and quantities', async ({ page }) => {
  const { admin, item, wo } = await mrqSetup([{ role: 'Admin', label: 'Stock' }]);
  const source = await makeWarehouse(admin, runSuffix(), 'MC', 'central');
  const requestId = await submittedRequest('engineer@acme.test', wo.id, item.id);

  await signIn(page, 'admin@acme.test');
  await page.goto(`/material-requests/${requestId}`);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByLabel(/warehouse the material leaves from/i).selectOption({ label: `${source.code} · ${source.name}` });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.goto(`/material-requests/${requestId}`);
  await page.getByRole('link', { name: 'Open the delivery document' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
  const lines = page.getByRole('row').filter({ hasText: item.code });
  await expect(lines.first()).toContainText('2');
});
