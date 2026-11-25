// @e2e-isolation: self-isolated — creates its own disposable storekeeper login, tag, item, central and yard locations and work order per run, and deletes all owned rows in finally.
/** JOB-W1 — client-supplied material arrives with its picking slip. Ruled path: Work orders → Client material → Record pickup.
 *  The material coordinator has the requisition and the client's reservation on the work order (the case's precondition); the storekeeper,
 *  keeper of the site store, records the pickup there with the slip photo; the material enters stock at zero cost, tagged to that work order. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, runSuffix, SEED_PROJECT_ID, userClient } from './support/stockFixture';

test.setTimeout(300_000);
const slip = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('JOB-W1 storekeeper records the pickup of client material on the work order with its slip, at zero cost, tagged to that work order', async ({ page }) => {
  const svc = serviceClient('JOB-W1');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'storekeeper', runId('w1-sk'));
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w1-mc'));
  const docIds: string[] = [];
  const tagName = `Client material ${sfx}`;
  const number = `WO-W1-${sfx}`;
  const workOrderId = randomUUID();
  let itemId = '';
  let unitId = '';
  let siteId = '';
  let tagId = '';
  try {
    const project = need('project', await svc.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single());
    ok('work order', await svc.from('work_orders').insert({ id: workOrderId, org_id: project.org_id, project_id: SEED_PROJECT_ID,
      title: `Client supplied work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
      order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.currency }));
    const item = await makeItem(admin, sfx, 'CLI');
    itemId = item.id;
    unitId = need('unit', await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id;
    const site = need('site', await admin.from('stock_warehouses').insert({ code: `E2E-SITE${sfx}`, name: `Site ${sfx}`, kind: 'site', project_id: SEED_PROJECT_ID }).select('id,code,name').single());
    siteId = site.id;
    // The org's "client material" tag belongs to stock master data, which an Admin sets up before the storekeeper's day.
    tagId = need('tag', await admin.from('stock_tags').insert({ name: tagName, zero_cost: true, paper_required: true, proof_required: 'paper' }).select('id').single()).id;
    ok('tag the item', await admin.from('stock_items').update({ tag_id: tagId }).eq('id', item.id));
    // The Admin names the storekeeper as keeper of the site store.
    await keeperOf(admin, site.id, storekeeper.id);
    await keeperOf(admin, site.id, coordinator.id);
    const unitCode = `E2E-U${sfx}`;
    const total = () => page.getByTestId(`csr-total-${item.id}-${unitCode}`);

    // Precondition: the work order has a client requisition for 8 with the client's reservation recorded (by the coordinator).
    await coordinator.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await expect(page.getByTestId('client-material-section')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'New requisition' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Client reference').fill(`CL-${sfx.slice(-6)}`);
    await form.getByLabel(/^Item/).selectOption({ label: `${item.code} · ${item.name} (${unitCode})` });
    await form.getByLabel(/Take-off quantity/).fill('8');
    await form.getByLabel(/Requested quantity/).fill('8');
    await form.getByRole('button', { name: 'Create requisition' }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Send to client' }).click();
    await page.getByRole('button', { name: 'Record reservation' }).click();
    const rsv = page.getByRole('dialog');
    await rsv.getByLabel(/Quantity reserved/).fill('8');
    await rsv.getByLabel(/Client's reference/).fill(`RSV-${sfx.slice(-6)}`);
    await rsv.getByRole('button', { name: 'Record reservation' }).click();
    await expect(rsv).toBeHidden({ timeout: 15_000 });

    // 1–3. The storekeeper opens Work orders → [work order] → Client material → Record pickup and attaches the slip.
    await storekeeper.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await expect(page.getByTestId('client-material-section')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Record pickup' }).click();
    const pick = page.getByRole('dialog');
    await pick.getByLabel(/Quantity collected/).fill('8');
    await pick.getByLabel(/Collected by/).fill('Site Driver');
    await expect(pick.getByLabel(/Received at/)).toHaveValue(site.id);
    await pick.getByLabel('Delivery slip photo').setInputFiles({ name: 'picking-slip.png', mimeType: 'image/png', buffer: slip });
    await pick.getByRole('button', { name: 'Record pickup' }).click();
    await expect(pick).toBeHidden({ timeout: 20_000 });

    // 4. Goal: collected 8 on that work order; stock rose by 8 at zero value in the site store; the slip is attached to the receipt.
    await expect(total().getByTestId('csr-collected')).toHaveText('8');
    const balance = await admin.rpc('get_work_order_stock_balance', { p_work_order_id: workOrderId });
    if (balance.error) throw new Error(`balance: ${balance.error.message}`);
    const balanceRow = (balance.data as Array<Record<string, string>>).find((r) => r.item_id === item.id);
    expect(balanceRow?.on_site_qty).toBe('8');
    expect(Number(balanceRow?.on_site_value)).toBe(0);
    const pickup = need('pickup', await svc.from('client_requisition_pickups').select('stock_document_id').eq('warehouse_id', site.id).single());
    docIds.push(pickup.stock_document_id as string);
    const line = need('receipt line', await svc.from('stock_document_lines').select('unit_cost').eq('document_id', pickup.stock_document_id).single());
    expect(Number(line.unit_cost)).toBe(0);
    const files = need('slip', await svc.from('stock_document_files').select('id').eq('document_id', pickup.stock_document_id));
    expect(files.length).toBeGreaterThan(0);
  } finally {
    sqlAsOwner(`
      delete from client_requisition_events where requisition_id in (select id from client_requisitions where work_order_id = '${workOrderId}');
      delete from client_requisition_pickups where requisition_id in (select id from client_requisitions where work_order_id = '${workOrderId}');
      delete from client_requisition_lines where requisition_id in (select id from client_requisitions where work_order_id = '${workOrderId}');
      delete from client_requisitions where work_order_id = '${workOrderId}';
    `);
    const ids = docIds.filter(Boolean);
    if (ids.length) {
      const list = ids.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_files where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    if (siteId) {
      sqlAsOwner(`delete from stock_ledger where warehouse_id = '${siteId}'; delete from stock_balances where warehouse_id = '${siteId}'; delete from stock_warehouse_keepers where warehouse_id = '${siteId}';`);
      ok('site cleanup', await svc.from('stock_warehouses').delete().eq('id', siteId));
    }
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (tagId) ok('tag cleanup', await svc.from('stock_tags').delete().eq('id', tagId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await storekeeper.cleanup();
    await coordinator.cleanup();
  }
});
