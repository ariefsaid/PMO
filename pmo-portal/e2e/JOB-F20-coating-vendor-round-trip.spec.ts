// @e2e-isolation: self-isolated — unique item and locations per run; the posted stock ledger is append-only, so every code carries a per-run suffix.
/**
 * JOB-F20 — coating vendor round trip (#2523). Pipe in the warehouse goes to a location standing for the coating vendor and
 * later comes back to site.
 * Goal oracle: the item's ledger shows both transfer legs and the vendor location holds zero at the end.
 * Partly built: the QC signature on pickup and the cargo document are not built, so only the two legs and balances are asserted.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';
import { expectOnHand, postTransfer } from './support/stockUi';

test.setTimeout(180_000);

test('JOB-F20 pipe sent to the coating vendor and back leaves two ledger legs and zero at the vendor', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'PIPE');
  const warehouse = await makeWarehouse(admin, sfx, 'WH', 'central');
  const vendor = await makeWarehouse(admin, sfx, 'COAT', 'site');
  const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
  await postReceive(admin, warehouse.id, item.id, '20');

  await signIn(page, 'admin@acme.test');
  await postTransfer(page, warehouse, vendor, item.code, '20');
  await postTransfer(page, vendor, site, item.code, '20');

  await page.goto(`/stock/ledger?item=${item.id}`);
  await expect.poll(() => page.getByRole('row').filter({ hasText: 'Transfer' }).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2); // each leg may show on both of its warehouses
  await expectOnHand(page, site, item.code, '20');
  await page.goto('/stock');
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).selectOption({ label: `${vendor.code} - ${vendor.name}` });
  await expect(page.getByRole('row', { name: new RegExp(item.code) }).getByRole('cell', { name: /^20\s+\S+$/ })).toHaveCount(0);
});
