// @e2e-isolation: self-isolated — creates its own disposable material coordinator login, item and two site locations per run, and deletes all owned rows in finally.
/** JOB-W4 — the material coordinator moves 6 of 10 units from site B to site C: site B reads 4, site C reads 6, and the all-locations view shows both. */
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';
import { chooseItem, label } from './support/jobStock';

test.setTimeout(150_000);

test('JOB-W4 material coordinator transfers between sites: 4 at the sender, 6 at the receiver, both in one view', async ({ page }) => {
  const svc = serviceClient('JOB-W4');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w4-mc'));
  let itemId = '';
  let unitId = '';
  let siteBId = '';
  let siteCId = '';
  let receiptId = '';
  let transferId = '';
  try {
    const item = await makeItem(admin, sfx, 'T');
    itemId = item.id;
    unitId = need('unit', await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id;
    const siteB = await makeWarehouse(admin, sfx, 'SB', 'site');
    siteBId = siteB.id;
    const siteC = await makeWarehouse(admin, sfx, 'SC', 'site');
    siteCId = siteC.id;
    await keeperOf(admin, siteB.id, coordinator.id);
    await keeperOf(admin, siteC.id, coordinator.id);
    receiptId = await postReceive(admin, siteB.id, item.id, '10', '25');

    // 1. Material coordinator sends 6 from site B to site C.
    await coordinator.signIn(page);
    await page.goto('/stock/new/transfer');
    await page.getByLabel('From warehouse').selectOption({ label: label(siteB) });
    await page.getByLabel('To warehouse').selectOption({ label: label(siteC) });
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('6');
    await page.getByRole('button', { name: 'Post stock transfer' }).click();
    await page.getByRole('dialog', { name: 'Post this stock transfer?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    transferId = page.url().split('/').pop() ?? '';

    // 2. Goal: site B reads 4 and site C reads 6 in the one all-locations view.
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    const rowB = page.getByRole('row').filter({ hasText: siteB.name });
    const rowC = page.getByRole('row').filter({ hasText: siteC.name });
    await expect(rowB).toContainText('4');
    await expect(rowC).toContainText('6');
  } finally {
    const docIds = [receiptId, transferId].filter(Boolean);
    if (docIds.length) {
      const list = docIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    const whIds = [siteBId, siteCId].filter(Boolean);
    if (whIds.length) {
      const list = whIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_balances where warehouse_id in (${list}); delete from stock_warehouse_keepers where warehouse_id in (${list});`);
      ok('locations cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await coordinator.cleanup();
  }
});
