// @e2e-isolation: self-isolated — creates its own disposable storekeeper login, tag, item, central and yard locations and work order per run, and deletes all owned rows in finally.
/** JOB-W1 — client-supplied material arrives with its picking slip: the storekeeper receives it at zero cost, moves it to the yard against the
 *  work order with the slip attached, and the work order shows it on site, tagged.
 *  Partly landed: the receive form has no work-order field and no attachments, so the work order and the slip are attached on the transfer that
 *  follows the receipt, not on the receipt itself. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, runSuffix, SEED_PROJECT_ID, userClient } from './support/stockFixture';
import { chooseItem, chooseWorkOrder, confirmPost, label } from './support/jobStock';

test.setTimeout(300_000);
const slip = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('JOB-W1 storekeeper receives client material at zero cost and it reaches the work order with its slip, under the tag', async ({ page }) => {
  const svc = serviceClient('JOB-W1');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w1-sk'));
  const tagName = `Client material ${sfx}`;
  const number = `WO-W1-${sfx}`;
  const workOrderId = randomUUID();
  let itemId = '';
  let unitId = '';
  let centralId = '';
  let yardId = '';
  let tagId = '';
  const docIds: string[] = [];
  try {
    const project = need('project', await svc.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single());
    ok('work order', await svc.from('work_orders').insert({ id: workOrderId, org_id: project.org_id, project_id: SEED_PROJECT_ID,
      title: `Client supplied work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
      order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.currency }));
    const item = await makeItem(admin, sfx, 'CLI');
    itemId = item.id;
    unitId = need('unit', await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id;
    const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
    centralId = central.id;
    const yardRow = await admin.from('stock_warehouses').insert({ code: `E2E-YARD${sfx}`, name: `Yard ${sfx}`, kind: 'yard', project_id: SEED_PROJECT_ID }).select('id,code,name').single();
    if (yardRow.error) throw yardRow.error;
    const yard = yardRow.data;
    yardId = yard.id;
    // The org's "client material" tag belongs to stock master data, which an Admin sets up before the storekeeper's day.
    tagId = need('tag', await admin.from('stock_tags').insert({ name: tagName, zero_cost: true, paper_required: true, proof_required: 'paper' }).select('id').single()).id;
    ok('tag the item', await admin.from('stock_items').update({ tag_id: tagId }).eq('id', item.id));
    // The Admin names the storekeeper as keeper of the central store it works.
    await keeperOf(admin, central.id, storekeeper.id);

    // 1. Storekeeper receives 8 at zero cost (the tag fixes the cost at zero and never asks for it).
    await storekeeper.signIn(page);
    await page.goto('/stock/new/receive');
    await page.getByLabel(/^Warehouse/).selectOption({ label: label(central) });
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('8');
    await expect(page.getByText('Client-supplied: the cost is fixed at zero.')).toBeVisible();
    await expect(page.getByLabel(/^Unit cost/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Post receipt' }).click();
    await page.getByRole('dialog', { name: 'Post this receipt?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    docIds.push(page.url().split('/').pop() ?? '');
    const receiptLine = await svc.from('stock_document_lines').select('unit_cost').eq('item_id', item.id).single();
    expect(Number(receiptLine.data?.unit_cost)).toBe(0);

    // 2. Storekeeper moves it to the yard against the work order and attaches the picking slip before it posts.
    await page.goto('/stock/new/transfer');
    await page.getByLabel('From warehouse').selectOption({ label: label(central) });
    await page.getByLabel('To warehouse').selectOption({ label: label(yard) });
    await chooseWorkOrder(page, number);
    await chooseItem(page, item.code);
    await page.getByLabel(/^Quantity/).fill('8');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const transferId = page.url().split('/').pop() ?? '';
    docIds.push(transferId);
    await page.getByRole('button', { name: 'Attachments', exact: true }).click();
    await page.getByLabel('Choose file').setInputFiles({ name: 'picking-slip.png', mimeType: 'image/png', buffer: slip });
    await page.getByLabel(/Label \(optional\)/).fill('Picking slip');
    await page.getByRole('button', { name: 'Upload attachment' }).click();
    await expect(page.getByRole('button', { name: 'Picking slip', exact: true })).toBeVisible();
    await confirmPost(page);

    // 3. Goal: the work order shows 8 on site at zero value, under the tag.
    await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
    const card = page.getByTestId(`customer-order-${workOrderId}`);
    await card.getByRole('button', { name: 'Stock for this work order' }).click();
    const row = card.getByRole('row').filter({ hasText: yard.code });
    await expect(row).toContainText(tagName);
    await expect(row.getByRole('cell').nth(5)).toContainText('8');
    await expect(row).toContainText('Client-supplied, no cost');
  } finally {
    const ids = docIds.filter(Boolean);
    if (ids.length) {
      const list = ids.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_files where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    const whIds = [centralId, yardId].filter(Boolean);
    if (whIds.length) {
      const list = whIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_balances where warehouse_id in (${list}); delete from stock_warehouse_keepers where warehouse_id in (${list});`);
      ok('locations cleanup', await svc.from('stock_warehouses').delete().in('id', whIds));
    }
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (tagId) ok('tag cleanup', await svc.from('stock_tags').delete().eq('id', tagId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await storekeeper.cleanup();
  }
});
