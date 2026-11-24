// @e2e-isolation: self-isolated — creates its own disposable storekeeper and material coordinator logins, project, work order, site warehouse, stock item and unit per run, and deletes all owned rows in finally.
/**
 * JOB-W16 (TC-W-15) — stock count variance booked to a work order.
 * A storekeeper counts 7 against 10 on hand at a site store, names the work order and a reason, and saves a draft;
 * a material coordinator posts the draft and opens the work order's Material completion report, which shows -3 counted difference and balance 7.
 */
import { test, expect } from '@playwright/test';
import { ok, projectWithWorkOrders, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { confirmPost, label } from './support/jobStock';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-W16 storekeeper drafts a work-order count variance and material coordinator posts it to material completion', async ({ page }) => {
  const svc = serviceClient('JOB-W16');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const run = runId('w16');
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w16-sk'));
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w16-mc'));
  let projectId = '';
  let workOrderId = '';
  let itemId = '';
  let unitId = '';
  let warehouseId = '';
  let receiptId = '';
  let countDocId = '';
  try {
    const setup = await projectWithWorkOrders(svc, run, ['Close-out pipework']);
    projectId = setup.projectId;
    const wo = setup.workOrders[0];
    workOrderId = wo.id;

    const item = await makeItem(admin, sfx, 'W16');
    itemId = item.id;
    const itemRow = await svc.from('stock_items').select('unit_id').eq('id', itemId).single();
    unitId = (itemRow.data?.unit_id as string | undefined) ?? '';

    const siteRes = await admin.from('stock_warehouses')
      .insert({ code: `E2E-W16${sfx}`, name: `Site W16 ${sfx}`, kind: 'site', project_id: projectId })
      .select('id,code,name').single();
    if (siteRes.error) throw siteRes.error;
    const site = siteRes.data;
    warehouseId = site.id;

    await keeperOf(admin, site.id, storekeeper.id);
    receiptId = await postReceive(admin, site.id, item.id, '10', '25');
    // Attribute the site receipt to the work order so the starting balance is 10 on this work order.
    ok('attribute receipt', await svc.from('stock_documents').update({ work_order_id: workOrderId }).eq('id', receiptId));

    // 1. Storekeeper drafts the count for the work order (7 vs 10 = -3) with a reason.
    await storekeeper.signIn(page);
    await page.goto('/stock/new/count');
    await page.getByLabel(/^Warehouse/).selectOption({ label: label(site) });
    await page.getByRole('combobox', { name: /^Work order/i }).click();
    await page.getByRole('option', { name: new RegExp(wo.number) }).click();
    await page.getByRole('button', { name: 'Fill from stock on hand' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace lines' }).click();
    await expect(page.getByTestId('system-1')).toContainText('10');
    await page.getByLabel(/^Counted/).fill('7');
    await expect(page.getByTestId('variance-1')).toContainText(/[−-]3/);
    await page.getByLabel(/^Reason/).fill('Joint close-out count shortage');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const documentUrl = new URL(page.url()).pathname;
    countDocId = documentUrl.split('/').pop() ?? '';

    // Separation of duties: the author cannot post a count with variance; work order link is visible.
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: wo.number })).toBeVisible();

    // 2. Material coordinator posts the draft.
    await coordinator.signIn(page);
    await page.goto(documentUrl);
    await confirmPost(page);

    // 3. Goal: Material completion report for the work order shows -3 counted difference and balance 7.
    await page.goto(`/work-orders/${workOrderId}/material-completion`);
    const row = page.getByTestId('material-completion-page').getByRole('row').filter({ hasText: item.code });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByRole('cell').nth(6)).toContainText(/[−-]3/);
    await expect(row.getByRole('cell').nth(7)).toContainText('7');
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
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await storekeeper.cleanup();
    await coordinator.cleanup();
  }
});
