// @e2e-isolation: self-isolated — creates its own disposable material coordinator login, item, unit and two stock locations per run, and deletes all owned rows in finally.
/** JOB-W20 — stock at two locations with guard cover recorded at one: the material coordinator opens Stock → At risk and the location without
 *  cover is the one flagged. The coordinator reads no value, so the report names the gap in words, never in money. */
import { test, expect } from '@playwright/test';
import { ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-W20 material coordinator sees the location without guard cover flagged as at risk', async ({ page }) => {
  const svc = serviceClient('JOB-W20');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w20-mc'));
  let itemId = '';
  let unitId = '';
  let coveredId = '';
  let uncoveredId = '';
  const docIds: string[] = [];
  try {
    const item = await makeItem(admin, sfx, 'RISK');
    itemId = item.id;
    unitId = (await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).data?.unit_id as string;
    const covered = await makeWarehouse(admin, sfx, 'COV', 'central');
    coveredId = covered.id;
    const uncovered = await makeWarehouse(admin, sfx, 'NOC', 'site');
    uncoveredId = uncovered.id;
    // The Admin records guard cover for one location only, as the stock set-up screen does.
    ok('cover', await admin.from('stock_warehouses').update({ cover_value: 500 }).eq('id', covered.id));
    docIds.push(await postReceive(admin, covered.id, item.id, '5', '25'));
    docIds.push(await postReceive(admin, uncovered.id, item.id, '5', '25'));

    // 1. Material coordinator opens Stock → At risk.
    await coordinator.signIn(page);
    await page.goto('/stock/at-risk');
    const coveredRow = page.getByRole('row').filter({ hasText: covered.code });
    const uncoveredRow = page.getByRole('row').filter({ hasText: uncovered.code });
    // 2. Goal: the location without cover is the one flagged at risk; the covered one is not.
    await expect(uncoveredRow).toContainText('No guard cover', { timeout: 20_000 });
    await expect(coveredRow).toContainText('Cover recorded');
  } finally {
    const ids = docIds.filter(Boolean);
    if (ids.length) {
      const list = ids.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    const whIds = [coveredId, uncoveredId].filter(Boolean);
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
