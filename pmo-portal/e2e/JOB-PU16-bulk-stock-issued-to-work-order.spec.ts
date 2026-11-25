// @e2e-isolation: self-isolated — unique item, central warehouse, work item and work order per run; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-PU16 — stock bought in bulk is held centrally with no work order; the storekeeper issues 20 units to a work order and that work order's material cost rises by 20 units at stock cost. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient, runId, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, userClient, SEED_PROJECT_ID, SEED_PROJECT_NAME } from './support/stockFixture';
import { chooseItem, chooseWorkOrder, label } from './support/jobStock';

test.setTimeout(180_000);

test('JOB-PU16 issuing 20 of a bulk stock to a work order charges it 20 units at stock cost', async ({ page }) => {
  const sfx = runSuffix();
  const number = `WO-PU16-${sfx}`;
  const workOrderId = randomUUID();
  const admin = await userClient('admin@acme.test');
  const service = serviceClient('JOB-PU16');
  const buyer = await roleJobUser(service, 'buyer', runId('pu16-buyer'));
  const storekeeper = await roleJobUser(service, 'storekeeper', runId('pu16-sk'));
  const docIds: string[] = [];
  let centralId = '';
  let itemId = '';
  let workItemId = '';
  try {
    const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
    if (project.error) throw project.error;
    const wo = await service.from('work_orders').insert({ id: workOrderId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID,
      title: `Bulk site work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
      order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
    if (wo.error) throw wo.error;
    const item = await makeItem(admin, sfx, 'BULK');
    const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
    centralId = central.id;
    itemId = item.id;
    const work = await makeWorkItem(admin, sfx);
    workItemId = work.id as unknown as string;
    // Bulk buy: 100 units received centrally with no work order, at 25 each.
    docIds.push(await postReceive(admin, central.id, item.id, '100', '25'));
    await keeperOf(admin, central.id, storekeeper.id);

    // 1. The buyer opens Purchasing and sees the buying screens.
    await buyer.signIn(page);
    await page.goto('/procurement');
    await expect(page.getByRole('heading', { name: /Procurement|Pengadaan/i }).first()).toBeVisible({ timeout: 20_000 });

    // 2. The storekeeper opens Stock -> Issue and issues 20 units to the work order.
    await storekeeper.signIn(page);
    await page.goto('/stock/new/issue');
    await page.getByLabel(/^Warehouse/).selectOption({ label: label(central) });
    await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
    await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
    await chooseWorkOrder(page, number);
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('20');
    await page.getByRole('button', { name: 'Post issue' }).click();
    await page.getByRole('dialog', { name: 'Post this issue?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    docIds.push(page.url().match(/\/stock\/documents\/([0-9a-f-]{36})$/)?.[1] ?? '');

    // 3. Goal: the work order's stock balance shows 20 issued at 25 each = 500. The storekeeper and the buyer do
    //    not see prices (story PU9), so the work order's own manager reads the cost it now carries.
    await signIn(page, 'pm@acme.test');
    await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
    const card = page.getByTestId(`customer-order-${workOrderId}`);
    await card.getByRole('button', { name: 'Stock for this work order' }).click();
    const row = card.getByRole('row').filter({ hasText: central.code });
    await expect(row).toContainText('20');
    await expect(row).toContainText('500');
  } finally {
    if (docIds.length) {
      const list = docIds.filter(id => /^[0-9a-f-]{36}$/.test(id)).map(id => `'${id}'`).join(',');
      if (list) sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    if (centralId) sqlAsOwner(`delete from stock_balances where warehouse_id = '${centralId}'; delete from stock_warehouse_keepers where warehouse_id = '${centralId}';`);
    if (centralId) await service.from('stock_warehouses').delete().eq('id', centralId);
    if (itemId) await service.from('stock_items').delete().eq('id', itemId);
    await service.from('stock_units').delete().eq('code', `E2E-U${sfx}`);
    if (workItemId) await service.from('boq_items').delete().eq('id', workItemId);
    await service.from('work_orders').delete().eq('id', workOrderId);
    await storekeeper.cleanup();
    await buyer.cleanup();
  }
});
