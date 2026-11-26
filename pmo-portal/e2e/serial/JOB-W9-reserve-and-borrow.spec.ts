// @e2e-isolation: serial — sets the organisation-wide material-request chain and borrowing approver, which every material-request journey reads; removes its own request, reservation and fixtures in finally.
/** JOB-W9 — stock reserved per work order, borrowing approved: with 100 units held and 40 reserved for work order A, work order B's request for 70
 *  is marked as borrowing 10 and takes the borrowing approval step. */
import { test, expect } from '@playwright/test';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { pickComboboxOption } from '../helpers';
import { sendForApproval } from '../support/mrqJobFixture';
import { roleJobUser } from '../support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';

test.setTimeout(240_000);

test('JOB-W9 a request over the free stock is marked borrowing and takes the borrowing approval step', async ({ page }) => {
  const svc = serviceClient('JOB-W9');
  const admin = await userClient('admin@acme.test');
  const coordinatorName = runId('w9-mc');
  const coordinator = await roleJobUser(svc, 'material_coordinator', coordinatorName);
  const requester = await roleJobUser(svc, 'engineer', runId('w9-req'));
  const run = runSuffix();
  let projectId = '';
  let woA = '';
  let woB = '';
  let itemId = '';
  let unitId = '';
  let warehouseId = '';
  let siteId = '';
  let receiptId = '';
  let requestId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
    }).select('id').single()).id;
    woA = need('work order A', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} work A`, wo_number: `WO-A-${run}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    woB = need('work order B', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} work B`, wo_number: `WO-B-${run}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    const item = await makeItem(admin, run, 'W9');
    itemId = item.id;
    unitId = need('unit', await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id;
    const store = await makeWarehouse(admin, run, 'CEN', 'central');
    warehouseId = store.id;
    const site = await makeWarehouse(admin, sfxSite(run), 'SITE', 'site', projectId);
    siteId = site.id;
    await keeperOf(admin, store.id, coordinator.id);
    receiptId = await postReceive(admin, store.id, item.id, '100', '10');

    // An Admin sets the chain and names who approves borrowing — organisation-wide, so this journey is serial.
    ok('chain', await admin.rpc('mrq_set_chain', { p_steps: [{ role: 'Admin', label: 'Stock', only_over_plan: false }] }));
    ok('borrowing approver', await admin.rpc('set_stock_reservations', { p_on: true, p_borrow_mode: 'approve', p_borrow_role: 'Engineer', p_borrow_label: 'Borrowing approval' }));

    // 1. The material coordinator holds 40 of the 100 for work order A on the stock screen.
    await coordinator.signIn(page);
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    // Reserve sits in the row's actions menu.
  await page.getByRole('button', { name: 'Row actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Reserve' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Project/).selectOption(projectId);
    await dialog.getByLabel(/^Work order/).selectOption(woA);
    await dialog.getByLabel(/^Quantity/).fill('40');
    await dialog.getByRole('button', { name: 'Reserve', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('row').filter({ hasText: store.name })).toContainText('40');

    // 2. Work order B asks for 70 — more than the 60 free. An engineer raises it on the New request screen.
    await requester.signIn(page);
    await page.goto('/material-requests/new');
    await pickComboboxOption(page, page, /^project/i, new RegExp(`${run} project`));
    await pickComboboxOption(page, page, /^work order/i, new RegExp(`WO-B-${run}`));
    await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
    await page.getByLabel(/^quantity/i).fill('70');
    await sendForApproval(page);
    await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    requestId = page.url().split('/').pop() ?? '';

    // 3. Goal: the coordinator reads the request marked as borrowing, with the borrowing approval step added.
    await coordinator.signIn(page);
    await page.goto(`/material-requests/${requestId}`);
    await expect(page.getByText('Borrowing.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/10 of this request comes from stock reserved for another work order/)).toBeVisible();
    await expect(page.getByTestId('mrq-chain')).toContainText('Borrowing approval');
    await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  } finally {
    if (requestId) sqlAsOwner(`delete from material_request_events where request_id = '${requestId}'; delete from material_request_steps where request_id = '${requestId}'; delete from material_request_lines where request_id = '${requestId}'; delete from material_requests where id = '${requestId}';`);
    sqlAsOwner(`delete from stock_reservation_events where reservation_id in (select id from stock_reservations where item_id = '${itemId || '00000000-0000-0000-0000-000000000000'}'); delete from stock_reservations where item_id = '${itemId || '00000000-0000-0000-0000-000000000000'}';`);
    const whIds = [warehouseId, siteId].filter(Boolean);
    if (itemId) sqlAsOwner(`delete from stock_ledger where item_id = '${itemId}'; delete from stock_balances where item_id = '${itemId}'; delete from stock_document_lines where item_id = '${itemId}';`);
    if (whIds.length) {
      const list = whIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_documents where warehouse_id in (${list}) or to_warehouse_id in (${list})${receiptId ? ` or id = '${receiptId}'` : ''}; delete from stock_warehouse_keepers where warehouse_id in (${list});`);
      ok('locations cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    ok('borrowing approver back to unset', await admin.rpc('set_stock_reservations', { p_on: true, p_borrow_mode: 'approve', p_borrow_role: null, p_borrow_label: null }));
    const woIds = [woA, woB].filter(Boolean);
    if (woIds.length) ok('work orders cleanup', await svc.from('work_orders').delete().in('id', woIds));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await requester.cleanup();
    await coordinator.cleanup();
  }
});

/** A warehouse code suffix that is stable for the run. */
function sfxSite(run: string): string {
  return run.slice(-6);
}
