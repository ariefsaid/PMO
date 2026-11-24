// @e2e-isolation: self-isolated — creates its own disposable storekeeper and material coordinator logins, stock item, unit and warehouse per run, and deletes all owned rows in finally.
/**
 * JOB-W17 — loss or damage write-off with two-person approval.
 * A storekeeper records an outbound adjustment of 1 unit with a reason and saves a draft (cannot post their own
 * write-off); a material coordinator opens the draft and posts it; stock on hand drops from 10 to 9 and the
 * ledger shows -1.
 */
import { test, expect } from '@playwright/test';
import { ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { chooseItem, confirmPost, label } from './support/jobStock';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-W17 storekeeper drafts a loss adjustment with a reason and material coordinator posts it', async ({ page }) => {
  const svc = serviceClient('JOB-W17');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w17-sk'));
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w17-mc'));
  let itemId = '';
  let unitId = '';
  let warehouseId = '';
  let receiptId = '';
  let adjDocId = '';
  try {
    const item = await makeItem(admin, sfx, 'W17');
    itemId = item.id;
    const itemRow = await svc.from('stock_items').select('unit_id').eq('id', itemId).single();
    unitId = (itemRow.data?.unit_id as string | undefined) ?? '';
    const store = await makeWarehouse(admin, sfx, 'STR', 'central');
    warehouseId = store.id;
    await keeperOf(admin, store.id, storekeeper.id);
    receiptId = await postReceive(admin, store.id, item.id, '10', '25');

    // 1. Storekeeper creates an outbound loss/damage adjustment draft with a reason.
    await storekeeper.signIn(page);
    await page.goto('/stock/new/adjustment');
    await page.getByLabel(/^Warehouse/).selectOption({ label: label(store) });
    await page.getByLabel(/^Reason/).fill('Broken during handling in store');
    await chooseItem(page, item.code);
    await expect(page.getByLabel(/^Direction/)).toHaveValue('out');
    await page.getByLabel(/^Quantity/).fill('1');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const documentUrl = new URL(page.url()).pathname;
    adjDocId = documentUrl.split('/').pop() ?? '';

    // Separation of duties: the author cannot post their own adjustment.
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);

    // 2. Material coordinator opens the draft and posts it.
    await coordinator.signIn(page);
    await page.goto(documentUrl);
    await confirmPost(page);

    // 3. Goal: ledger shows -1 and stock on hand drops to 9.
    await page.goto(`/stock/ledger?item=${item.id}`);
    await expect(page.getByRole('row').filter({ hasText: 'Adjustment' }).first()).toContainText(/[−-]1/, { timeout: 20_000 });
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    await expect(page.getByRole('row').filter({ hasText: store.name })).toContainText('9', { timeout: 20_000 });
  } finally {
    const docIds = [adjDocId, receiptId].filter(Boolean);
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
