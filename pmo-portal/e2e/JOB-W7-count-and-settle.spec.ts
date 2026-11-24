// @e2e-isolation: self-isolated — unique item and central warehouse per run; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-W7 — a count of 47 against a system stock of 50 is written up, another person posts it, stock reads 47 and the ledger shows the 3 lost.
 *  Partly landed: the count and its variance post; settling the difference by a transfer between work orders is held (not tested). */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';
import { confirmPost, label } from './support/jobStock';

test.setTimeout(180_000);

test('JOB-W7 a count of 47 against 50 posts a 3-unit difference and stock reads 47', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'CNT');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  await postReceive(admin, central.id, item.id, '50', '25');

  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/new/count');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(central) });
  await page.getByRole('button', { name: 'Fill from stock on hand' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Replace lines' }).click();
  await page.getByLabel(/^Counted/).fill('47');
  await expect(page.getByTestId('system-1')).toContainText('50');
  await page.getByLabel(/^Reason/).fill('three bags damaged');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const documentUrl = new URL(page.url()).pathname;

  // Another person posts it.
  await signIn(page, 'pm@acme.test');
  await page.goto(documentUrl);
  await confirmPost(page);

  await page.goto(`/stock/ledger?item=${item.id}`);
  await expect(page.getByRole('row').filter({ hasText: 'Stock count' }).first()).toContainText(/[-−]3/);
  await page.goto('/stock');
  await page.getByPlaceholder('Search items').fill(item.code);
  await expect(page.getByRole('row').filter({ hasText: central.name })).toContainText('47');
});
