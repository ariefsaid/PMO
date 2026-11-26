// @e2e-isolation: self-isolated — creates its own disposable material coordinator login, item, two staging locations, work item and work order per run, and deletes all owned rows in finally.
/** JOB-W5 — a staging area is a stock location: a transfer to one staging area raises only that area's balance, and with 30 dispatched to the
 *  work order and 20 reported installed its field stock reads 10 on the work order. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, SEED_PROJECT_ID, SEED_PROJECT_NAME, userClient } from './support/stockFixture';
import { chooseItem, chooseWorkOrder, label } from './support/jobStock';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(240_000);

test('JOB-W5 material coordinator moves stock to one staging area and only that area rises', async ({ page }) => {
  const svc = serviceClient('JOB-W5');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w5-mc'));
  const number = `WO-W5-${sfx}`;
  const workOrderId = randomUUID();
  let itemId = '';
  let unitId = '';
  const whIds: string[] = [];
  const docIds: string[] = [];
  try {
    const project = need('project', await svc.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single());
    ok('work order', await svc.from('work_orders').insert({ id: workOrderId, org_id: project.org_id, project_id: SEED_PROJECT_ID,
      title: `Staging work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
      order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.currency }));
    const item = await makeItem(admin, sfx, 'STG');
    itemId = item.id;
    unitId = need('unit', await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id;
    const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
    whIds.push(central.id);
    const stagingA = need('staging A', await admin.from('stock_warehouses').insert({ code: `E2E-STGA${sfx}`, name: `Staging A ${sfx}`, kind: 'staging', project_id: SEED_PROJECT_ID }).select('id,code,name').single());
    whIds.push(stagingA.id);
    const stagingB = need('staging B', await admin.from('stock_warehouses').insert({ code: `E2E-STGB${sfx}`, name: `Staging B ${sfx}`, kind: 'staging', project_id: SEED_PROJECT_ID }).select('id,code,name').single());
    whIds.push(stagingB.id);
    await keeperOf(admin, central.id, coordinator.id);
    await keeperOf(admin, stagingA.id, coordinator.id);
    await keeperOf(admin, stagingB.id, coordinator.id);
    const work = await makeWorkItem(admin, sfx);
    docIds.push(await postReceive(admin, central.id, item.id, '30', '25'));

    // 1. Material coordinator moves 30 to staging area A, for this work order.
    await coordinator.signIn(page);
    await page.goto('/stock/new/transfer');
    await page.getByLabel('From warehouse').selectOption({ label: label(central) });
    await page.getByLabel('To warehouse').selectOption({ label: label(stagingA) });
    await chooseWorkOrder(page, number);
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('30');
    await page.getByRole('button', { name: 'Post stock transfer' }).click();
    await page.getByRole('dialog', { name: 'Post this stock transfer?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    docIds.push(page.url().split('/').pop() ?? '');

    // 2. Goal: only staging area A's balance rises; B has nothing.
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    await expect(page.getByRole('row').filter({ hasText: stagingA.name })).toContainText('30');
    await expect(page.getByRole('row').filter({ hasText: stagingB.name })).toHaveCount(0);

    // 3. The field reports 20 installed from the staging area onto the work order.
    await page.goto('/stock/new/issue');
    await page.getByLabel(/^Warehouse/).selectOption({ label: label(stagingA) });
    await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
    await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
    await chooseWorkOrder(page, number);
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('20');
    await page.getByRole('button', { name: 'Post issue' }).click();
    await page.getByRole('dialog', { name: 'Post this issue?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    docIds.push(page.url().split('/').pop() ?? '');

    // 4. The work order's staging row still reads 10 (30 dispatched minus 20 installed).
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'material');
    const panel = page.getByRole('region', { name: 'Stock for this work order' });
    const row = panel.getByRole('row').filter({ hasText: stagingA.code });
    await expect(row.getByRole('cell').nth(4)).toHaveText(/^20\b/);
    await expect(row.getByRole('cell').nth(5)).toContainText('10');
  } finally {
    const ids = docIds.filter(Boolean);
    if (ids.length) {
      const list = ids.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_files where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    if (whIds.length) {
      const list = whIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_balances where warehouse_id in (${list}); delete from stock_warehouse_keepers where warehouse_id in (${list});`);
      ok('locations cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    ok('work item cleanup', await svc.from('boq_items').delete().eq('project_id', SEED_PROJECT_ID).eq('item_code', `E2E-W${sfx}`));
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await coordinator.cleanup();
  }
});
