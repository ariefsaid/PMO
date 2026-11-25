// @e2e-isolation: self-isolated — creates its own disposable storekeeper login, item and site location per run with its own reorder level; the request is raised as a draft, never saved.
/** JOB-W11 — stock below its minimum is flagged; the storekeeper opens the reorder and raises a purchase request from it that carries the item and
 *  the suggested quantity (20 minimum − 5 on hand = 15). */
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(150_000);

test('JOB-W11 storekeeper raises a purchase request from a low-stock item with the suggested quantity', async ({ page }) => {
  const svc = serviceClient('JOB-W11');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w11-sk'));
  let itemId = '';
  let unitId = '';
  let siteId = '';
  let receiptId = '';
  try {
    const item = await makeItem(admin, sfx, 'R');
    itemId = item.id;
    unitId = need('unit', await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id;
    const site = await makeWarehouse(admin, sfx, 'RO', 'site');
    siteId = site.id;
    await keeperOf(admin, site.id, storekeeper.id);
    receiptId = await postReceive(admin, site.id, item.id, '5', '25');
    const set = await admin.rpc('set_stock_reorder_level', { p_warehouse_id: site.id, p_item_id: item.id, p_level: 20, p_quantity: null });
    if (set.error) throw new Error(set.error.message);

    // 1. Storekeeper opens Stock → Reorder and sees the below-minimum stock.
    await storekeeper.signIn(page);
    await page.goto('/stock/reorder');
    await expect(page.getByRole('row').filter({ hasText: item.code })).toBeVisible({ timeout: 20_000 });

    // 2. From that same Reorder list it raises the purchase request.
    await page.getByRole('button', { name: `Request purchase for ${item.code}` }).click();
    await expect(page).toHaveURL(/\/procurement\/new\?/);
    // 3. Goal: the request carries the item and the suggested quantity. A storekeeper sees no price, so the line waits in the add row, quantity filled in.
    await expect(page.getByLabel(/^title/i)).toHaveValue(new RegExp(item.code));
    await expect(page.locator('input[aria-label="New item quantity"]:visible')).toHaveValue('15');
  } finally {
    if (siteId) sqlAsOwner(`delete from stock_reorder_levels where warehouse_id = '${siteId}';`);
    if (receiptId) sqlAsOwner(`delete from stock_ledger where document_id = '${receiptId}'; delete from stock_document_lines where document_id = '${receiptId}'; delete from stock_documents where id = '${receiptId}';`);
    if (siteId) {
      sqlAsOwner(`delete from stock_balances where warehouse_id = '${siteId}'; delete from stock_warehouse_keepers where warehouse_id = '${siteId}';`);
      ok('location cleanup', await svc.from('stock_warehouses').delete().eq('id', siteId));
    }
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await storekeeper.cleanup();
  }
});
