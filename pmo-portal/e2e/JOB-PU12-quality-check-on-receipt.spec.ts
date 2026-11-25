// @e2e-isolation: self-isolated — unique item (flagged for a quality check), central warehouse and storekeeper login per run; the posted ledger is append-only so codes carry a per-run suffix, and the journey deletes what it made.
/** JOB-PU12 — an item flagged "needs quality check" arrives (10 units); the storekeeper must say how many passed and how many were rejected:
 *  accept 8, reject 2 with a note. Stock on hand rises by 8, and the receipt shows 2 rejected. */
import { test, expect } from '@playwright/test';
import { serviceClient, runId, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, runSuffix, userClient } from './support/stockFixture';
import { chooseItem, label } from './support/jobStock';

test.setTimeout(180_000);

test('JOB-PU12 receiving 10 of a flagged item as 8 passed and 2 rejected puts 8 on hand and shows 2 rejected on the receipt', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const service = serviceClient('JOB-PU12');
  const storekeeper = await roleJobUser(service, 'storekeeper', runId('pu12-sk'));
  let docId = '';
  let warehouseId = '';
  let itemId = '';
  try {
    const item = await makeItem(admin, sfx, 'QCI');
    itemId = item.id;
    const flagged = await admin.from('stock_items').update({ needs_quality_check: true }).eq('id', item.id).select('id');
    if (flagged.error || flagged.data?.length !== 1) throw new Error(`flag the item: ${flagged.error?.message ?? 'no row updated'}`);
    const warehouse = await makeWarehouse(admin, sfx, 'QCW', 'central');
    warehouseId = warehouse.id;
    await keeperOf(admin, warehouse.id, storekeeper.id);

    // 1. The storekeeper opens Stock and chooses Receive goods; 10 units of the flagged item arrived.
    await storekeeper.signIn(page);
    await page.goto('/stock');
    await page.getByRole('link', { name: 'Receive goods' }).click();
    await expect(page).toHaveURL(/\/stock\/new\/receive$/);
    const form = page.getByTestId('stock-movement-form');
    await expect(form).toBeVisible();
    await form.getByLabel(/^Warehouse/).selectOption({ label: label(warehouse) });
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('10');
    await page.getByLabel(/^Unit cost/).fill('25');

    // 2. The item needs a quality check: the receipt does not post until the storekeeper says how many passed and how many were rejected.
    await expect(page.getByLabel(/^Passed/)).toBeVisible();
    await page.getByRole('button', { name: 'Post receipt' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Enter a number, zero or more (3 decimals at most).').first()).toBeVisible();

    // 3. Accepts 8 and rejects 2, with the reason.
    await page.getByLabel(/^Passed/).fill('8');
    await page.getByLabel(/^Rejected/).fill('2');
    await page.getByLabel(/Why is some rejected/).fill('Cracked in transit');
    await page.getByRole('button', { name: 'Post receipt' }).click();
    await page.getByRole('dialog', { name: 'Post this receipt?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    docId = page.url().match(/\/stock\/documents\/([0-9a-f-]{36})$/)?.[1] ?? '';

    // 4. Goal: the receipt shows 2 rejected, and stock on hand rose by 8 (not 10).
    await expect(page.getByText('rejected 2: Cracked in transit')).toBeVisible();
    await expect(page.getByText('passed 8')).toBeVisible();
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    const row = page.getByRole('row').filter({ hasText: warehouse.name });
    await expect(row).toContainText('8');
    await expect(row).not.toContainText('10');
  } finally {
    if (docId) sqlAsOwner(`delete from stock_ledger where document_id = '${docId}'; delete from stock_document_lines where document_id = '${docId}'; delete from stock_documents where id = '${docId}';`);
    if (warehouseId) sqlAsOwner(`delete from stock_balances where warehouse_id = '${warehouseId}'; delete from stock_warehouse_keepers where warehouse_id = '${warehouseId}';`);
    if (warehouseId) await service.from('stock_warehouses').delete().eq('id', warehouseId);
    if (itemId) await service.from('stock_items').delete().eq('id', itemId);
    await service.from('stock_units').delete().eq('code', `E2E-U${sfx}`);
    await storekeeper.cleanup();
  }
});
