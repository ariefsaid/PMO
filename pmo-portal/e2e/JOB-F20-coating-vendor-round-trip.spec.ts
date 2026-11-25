// @e2e-isolation: self-isolated — unique item and locations per run; the posted stock ledger is append-only, so every code carries a per-run suffix.
/**
 * JOB-F20 — coating vendor round trip (#2523). The material coordinator holds the store, so pipe in the warehouse goes to a
 * location standing for the coating vendor and later comes back to site.
 * Goal oracle: the item's ledger shows both transfer legs and the vendor location holds zero at the end.
 * Partly built: the QC signature on pickup and the cargo document are not built, so only the two legs and balances are asserted.
 */
import { test, expect } from '@playwright/test';
import { runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';
import { expectOnHand, postTransfer } from './support/stockUi';

test.setTimeout(180_000);

test('JOB-F20 the material coordinator sends pipe to the coating vendor and back, leaving two ledger legs and zero at the vendor', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const coordinator = await roleJobUser(serviceClient('JOB-F20'), 'material_coordinator', runId('f20-mc'));
  try {
    const item = await makeItem(admin, sfx, 'PIPE');
    const warehouse = await makeWarehouse(admin, sfx, 'WH', 'central');
    const vendor = await makeWarehouse(admin, sfx, 'COAT', 'site');
    const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
    await postReceive(admin, warehouse.id, item.id, '20');
    // The coordinator keeps the store, as an Admin assigns keepers.
    for (const wh of [warehouse, vendor, site]) await keeperOf(admin, wh.id, coordinator.id);

    await coordinator.signIn(page);
    await postTransfer(page, warehouse, vendor, item.code, '20');
    await postTransfer(page, vendor, site, item.code, '20');

    await page.goto(`/stock/ledger?item=${item.id}`);
    // Both legs are in the ledger: warehouse → vendor (out of the warehouse, into the vendor) and vendor → site (out of the vendor, into the site).
    const leg = (wh: { code: string }, sign: '-' | '+') => page.getByRole('row')
      .filter({ hasText: 'Transfer' })
      .filter({ has: page.getByTestId('stock-ledger-warehouse-code').getByText(wh.code, { exact: true }) })
      .filter({ has: page.getByTestId('stock-ledger-change').getByText(new RegExp(`^\\${sign}20$`)) });
    await expect(leg(warehouse, '-')).toHaveCount(1, { timeout: 20_000 });
    await expect(leg(vendor, '+')).toHaveCount(1);
    await expect(leg(vendor, '-')).toHaveCount(1);
    await expect(leg(site, '+')).toHaveCount(1);
    await expectOnHand(page, site, item.code, '20');
    await page.goto('/stock');
    await page.getByRole('combobox', { name: 'Warehouse', exact: true }).selectOption({ label: `${vendor.code} - ${vendor.name}` });
    await expect(page.getByRole('row', { name: new RegExp(item.code) }).getByRole('cell', { name: /^20\s+\S+$/ })).toHaveCount(0);
    // And the zero is shown: with zero balances listed, the vendor holds 0 of the item.
    const showZero = page.getByRole('checkbox', { name: 'Show zero balances' });
    await showZero.click(); // the control settles its state after the click, so assert it rather than let check() judge it at once
    await expect(showZero).toBeChecked();
    await expect(page.getByRole('row', { name: new RegExp(item.code) }).getByRole('cell', { name: /^0\s+\S+$/ })).toBeVisible({ timeout: 20_000 });
  } finally {
    // The keeper rows an Admin assigned point at the coordinator's profile; remove them before it goes.
    // Its two transfers carry the coordinator as author, so they go first (receipt ledger legs stay: the ledger is append-only by design).
    const own = `select id from stock_documents where created_by = '${coordinator.id}'`;
    sqlAsOwner(`delete from stock_ledger where document_id in (${own}); delete from stock_document_lines where document_id in (${own}); delete from stock_documents where created_by = '${coordinator.id}'; delete from stock_warehouse_keepers where user_id = '${coordinator.id}';`);
    await coordinator.cleanup();
  }
});
