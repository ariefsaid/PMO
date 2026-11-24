// @e2e-isolation: self-isolated — owns its executive login, project, work order, overdue billing step, stock item and site warehouse; removes them in finally.
// JOB-M4 (management): alarms that money is waiting — an overdue billing step on the billing board and low stock on the reorder worklist.
import { test, expect } from '@playwright/test';
import { cleanupAll, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { inDays } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(120_000);

test('JOB-M4 executive sees an overdue billing step on the billing board and low stock on the reorder worklist', async ({ page }) => {
  const svc = serviceClient('JOB-M4');
  const run = runId('JOBM4');
  const suffix = runSuffix();
  const actor = await roleJobUser(svc, 'executive', run);
  const admin = await userClient('admin@acme.test');

  let projectId = '';
  let woIds: string[] = [];
  let itemId = '';
  let siteId = '';
  let receiptId = '';

  try {
    const fx = await projectWithWorkOrders(svc, run, ['Main line']);
    projectId = fx.projectId;
    woIds = fx.workOrders.map((w) => w.id);
    const wo = fx.workOrders[0];

    ok('overdue billing step', await svc.from('work_order_billing_steps').insert({
      org_id: ORG_ID,
      work_order_id: wo.id,
      project_id: projectId,
      position: 1,
      name: 'Client sign-off',
      owner_role_key: 'billing_officer',
      target_days: 3,
      started_on: inDays(-9),
    }));

    const item = await makeItem(admin, suffix, 'M4');
    itemId = item.id;
    const site = await makeWarehouse(admin, suffix, 'M4', 'site');
    siteId = site.id;
    receiptId = await postReceive(admin, site.id, item.id, '20', '25');
    ok('reorder level', await admin.rpc('set_stock_reorder_level', {
      p_warehouse_id: site.id,
      p_item_id: item.id,
      p_level: 150,
      p_quantity: null,
    }));

    await actor.signIn(page);

    // 1. Billing board: the overdue billing step stands out past its target days.
    await page.goto('/finance/billing-board');
    const woSteps = page.getByTestId('billing-board-wo-steps');
    await expect(woSteps).toBeVisible({ timeout: 30_000 });
    const card = woSteps.getByRole('listitem').filter({ hasText: wo.number }).first();
    await expect(card).toContainText('Client sign-off');
    await expect(card).toContainText('Current');
    await expect(card).toContainText(/\d+ days? past target/);

    // 2. Reorder worklist: stock on hand below its minimum (20 against 150) appears in the below-reorder warning list.
    await page.goto('/stock/reorder');
    const row = page.getByRole('table', { name: 'Below reorder level' }).getByRole('row').filter({ hasText: item.code });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(site.code);
    await expect(row).toContainText('20');
    await expect(row).toContainText('150');
  } finally {
    if (receiptId) {
      sqlAsOwner(`delete from stock_ledger where document_id = '${receiptId}'; delete from stock_document_lines where document_id = '${receiptId}'; delete from stock_documents where id = '${receiptId}';`);
    }
    if (siteId && itemId) {
      ok('reorder cleanup', await svc.from('stock_reorder_levels').delete().eq('warehouse_id', siteId).eq('item_id', itemId));
    }
    if (siteId) {
      sqlAsOwner(`delete from stock_balances where warehouse_id = '${siteId}';`);
      ok('warehouse cleanup', await svc.from('stock_warehouses').delete().eq('id', siteId));
    }
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    await cleanupAll(svc, [
      ['work_order_billing_steps', 'work_order_id', woIds],
      ['work_orders', 'id', woIds],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    await actor.cleanup();
  }
});
