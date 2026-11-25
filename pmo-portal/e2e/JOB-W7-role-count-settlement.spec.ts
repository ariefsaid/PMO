// @e2e-isolation: self-isolated — creates its own disposable storekeeper and material coordinator logins, stock item, unit and warehouse per run, and deletes all owned rows in finally.
/**
 * JOB-W7 — stock count with variance and two-person settlement.
 * A storekeeper counts 47 against 50 on hand with a reason and saves a draft (cannot post their own variance);
 * a material coordinator posts the draft; on-hand stock reads 47 and the ledger records -3.
 */
import { test, expect } from '@playwright/test';
import { ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { confirmPost, label } from './support/jobStock';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-W7 storekeeper saves a count with a 3-unit variance and material coordinator posts it', async ({ page }) => {
  const svc = serviceClient('JOB-W7');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w7-sk'));
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w7-mc'));
  let itemId = '';
  let unitId = '';
  let warehouseId = '';
  let receiptId = '';
  let countDocId = '';
  try {
    const item = await makeItem(admin, sfx, 'W7');
    itemId = item.id;
    const itemRow = await svc.from('stock_items').select('unit_id').eq('id', itemId).single();
    unitId = (itemRow.data?.unit_id as string | undefined) ?? '';
    const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
    warehouseId = central.id;
    await keeperOf(admin, central.id, storekeeper.id);
    receiptId = await postReceive(admin, central.id, item.id, '50', '25');

    // 1. Storekeeper records the physical count (47 vs 50) with a reason and saves a draft.
    await storekeeper.signIn(page);
    await page.goto('/stock/new/count');
    await page.getByLabel(/^Warehouse/).selectOption({ label: label(central) });
    await page.getByRole('button', { name: 'Fill from stock on hand' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace lines' }).click();
    await expect(page.getByTestId('system-1')).toContainText('50');
    await page.getByLabel(/^Counted/).fill('47');
    await expect(page.getByTestId('variance-1')).toContainText(/[−-]3/);
    await page.getByLabel(/^Reason/).fill('Three units damaged in store');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const documentUrl = new URL(page.url()).pathname;
    countDocId = documentUrl.split('/').pop() ?? '';

    // Separation of duties: the author cannot post a count with variance.
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);

    // 2. Material coordinator reviews and posts the draft.
    await coordinator.signIn(page);
    await page.goto(documentUrl);
    await confirmPost(page);

    // 3. Goal: ledger shows -3 and on-hand stock reads 47.
    await page.goto(`/stock/ledger?item=${item.id}`);
    await expect(page.getByRole('row').filter({ hasText: 'Stock count' }).first()).toContainText(/[−-]3/, { timeout: 20_000 });
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    await expect(page.getByRole('row').filter({ hasText: central.name })).toContainText('47', { timeout: 20_000 });
  } finally {
    const docIds = [countDocId, receiptId].filter(Boolean);
    if (docIds.length) {
      const list = docIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    if (warehouseId) {
      sqlAsOwner(`delete from stock_balances where warehouse_id = '${warehouseId}'; delete from stock_warehouse_keepers where warehouse_id = '${warehouseId}';`);
      ok('warehouse cleanup', await svc.from('stock_warehouses').delete().eq('id', warehouseId));
    }
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await storekeeper.cleanup();
    await coordinator.cleanup();
  }
});
