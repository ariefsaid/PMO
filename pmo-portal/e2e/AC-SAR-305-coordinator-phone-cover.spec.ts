// @e2e-isolation: self-isolated — owns its coordinator login, item and warehouse; removes only those rows and their ledger fixtures.
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test('AC-SAR-305 Material Coordinator sees missing guard cover on a phone', async ({ page }) => {
  const svc = serviceClient('AC-SAR-305');
  const actor = await roleJobUser(svc, 'material_coordinator', runId('cover'));
  const admin = await userClient('admin@acme.test');
  const suffix = runSuffix();
  let itemId = ''; let warehouseId = ''; let receiptId = ''; let coveredId = ''; let coveredReceipt = '';
  try {
    const item = await makeItem(admin, suffix, 'GC'); itemId = item.id;
    const warehouse = await makeWarehouse(admin, suffix, 'GC', 'site'); warehouseId = warehouse.id;
    receiptId = await postReceive(admin, warehouse.id, item.id, '10', '25');
    const covered = await makeWarehouse(admin, suffix, 'GCC', 'site'); coveredId = covered.id;
    ok('guard cover setup', await admin.from('stock_warehouses').update({ cover_value: 1000 }).eq('id', covered.id));
    coveredReceipt = await postReceive(admin, covered.id, item.id, '10', '25');
    await page.setViewportSize({ width: 390, height: 844 });
    await actor.signIn(page);
    await page.goto('/stock/at-risk');
    const cards = page.getByTestId('dt-card-branch');
    const card = cards.getByRole('listitem').filter({ hasText: warehouse.code });
    await expect(card.getByText('No guard cover', { exact: true })).toBeVisible();
    await expect(cards.getByRole('listitem').filter({ hasText: covered.code }).getByText('Cover recorded', { exact: true })).toBeVisible();
    await expect(card.getByText('Stock value', { exact: true })).toHaveCount(0);
    need('warehouse still has no cover', await admin.from('stock_warehouses').select('cover_value').eq('id', warehouse.id).is('cover_value', null).single());
  } finally {
    // The immutable ledger has no app delete; scoped fixture cleanup follows the stock journey convention.
    if (coveredReceipt) sqlAsOwner(`delete from stock_ledger where document_id = '${coveredReceipt}'; delete from stock_document_lines where document_id = '${coveredReceipt}'; delete from stock_documents where id = '${coveredReceipt}';`);
    if (coveredId) { sqlAsOwner(`delete from stock_balances where warehouse_id = '${coveredId}';`); ok('covered warehouse cleanup', await svc.from('stock_warehouses').delete().eq('id', coveredId)); }
    if (receiptId) sqlAsOwner(`delete from stock_ledger where document_id = '${receiptId}'; delete from stock_document_lines where document_id = '${receiptId}'; delete from stock_documents where id = '${receiptId}';`);
    if (warehouseId) { sqlAsOwner(`delete from stock_balances where warehouse_id = '${warehouseId}';`); ok('warehouse cleanup', await svc.from('stock_warehouses').delete().eq('id', warehouseId)); }
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    await actor.cleanup();
  }
});
