// @e2e-isolation: self-isolated — creates its own disposable storekeeper login, stock item, unit and two keeperless warehouses per run, and deletes all owned rows in finally.
/**
 * JOB-RSD — the warehouse-keeper default (RR-3, FR-RSD-006).
 * No keeper is named on either warehouse and no Admin sets one. A storekeeper opens the transfer form, sees both
 * keeperless warehouses offered, and posts a transfer between them — the keeper right the default grants — and the
 * on-hand figures follow.
 */
import { test, expect } from '@playwright/test';
import { ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { chooseItem, label } from './support/jobStock';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-RSD a storekeeper moves stock between warehouses that name no keeper', async ({ page }) => {
  const svc = serviceClient('JOB-RSD');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('rsd-sk'));
  let itemId = '';
  let unitId = '';
  let warehouseA = '';
  let warehouseB = '';
  let receiptId = '';
  let transferId = '';
  try {
    const item = await makeItem(admin, sfx, 'RD');
    itemId = item.id;
    const itemRow = await svc.from('stock_items').select('unit_id').eq('id', itemId).single();
    unitId = (itemRow.data?.unit_id as string | undefined) ?? '';
    // Both warehouses keep their shipped default: no stock_warehouse_keepers row is created for either.
    const from = await makeWarehouse(admin, sfx, 'RA', 'central');
    warehouseA = from.id;
    const to = await makeWarehouse(admin, sfx, 'RB', 'central');
    warehouseB = to.id;
    const keepers = await svc.from('stock_warehouse_keepers').select('warehouse_id').in('warehouse_id', [warehouseA, warehouseB]);
    if (keepers.error) throw new Error('keeper read: ' + keepers.error.message);
    if ((keepers.data ?? []).length > 0) throw new Error('precondition: a keeper is named; the default-under-test would not be exercised');
    receiptId = await postReceive(admin, warehouseA, item.id, '10', '25');

    // 1. Goal: the storekeeper — not a named keeper, no Admin setup — transfers stock between the two.
    await storekeeper.signIn(page);
    await page.goto('/stock/new/transfer');
    await page.getByLabel('From warehouse').selectOption({ label: label(from) });
    await page.getByLabel('To warehouse').selectOption({ label: label(to) });
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('4');
    await page.getByRole('button', { name: 'Post stock transfer' }).click();
    await page.getByRole('dialog', { name: 'Post this stock transfer?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    transferId = page.url().split('/').pop() ?? '';

    // 2. Goal: the stock followed — site B reads 4 in the one all-locations view.
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    await expect(page.getByRole('row').filter({ hasText: to.name }).locator('span.tabular-nums').first()).toHaveText(/^4(?:[.,]0+)?(?:\s|$)/, { timeout: 20_000 });
  } finally {
    const docIds = [transferId, receiptId].filter(Boolean);
    if (docIds.length) {
      const list = docIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    for (const warehouseId of [warehouseA, warehouseB].filter(Boolean)) {
      sqlAsOwner(`delete from stock_balances where warehouse_id = '${warehouseId}'; delete from stock_warehouse_keepers where warehouse_id = '${warehouseId}';`);
      ok('warehouse cleanup', await svc.from('stock_warehouses').delete().eq('id', warehouseId));
    }
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await storekeeper.cleanup();
  }
});
