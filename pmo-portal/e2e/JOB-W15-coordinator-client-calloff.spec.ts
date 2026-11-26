// @e2e-isolation: self-isolated — creates its own disposable material coordinator login, project, work order, client-supplied item, tag, unit and site location per run, and deletes all owned rows in finally.
/**
 * JOB-W15 — client-supplied material calloff, reservation gate, and pickup.
 * A material coordinator raises a client material requisition from a work order, sends it, sees pickup before
 * reservation refused, records the client's reservation (50), records a partial pickup (30) into the site store,
 * and verifies reserved (50), collected (30), still to collect (20), and zero-value site stock.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, runSuffix, userClient } from './support/stockFixture';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(240_000);

test('JOB-W15 material coordinator calls off client material, hits the reservation gate, reserves and records pickup at zero value', async ({ page }) => {
  const svc = serviceClient('JOB-W15');
  const admin = await userClient('admin@acme.test');
  const run = runId('w15');
  const sfx = runSuffix();
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w15-mc'));
  let projectId = '';
  let woId = '';
  let unitId = '';
  let tagId = '';
  let itemId = '';
  let siteId = '';
  try {
    const unit = need('unit', await admin.from('stock_units').insert({ code: `W15U${sfx.slice(-6)}`, name: `Unit ${sfx}`, whole_only: true }).select('id, code').single());
    unitId = unit.id;
    const tag = need('tag', await admin.from('stock_tags').insert({ name: `Client supplied ${sfx}`, zero_cost: true }).select('id').single());
    tagId = tag.id;
    const item = need('item', await admin.from('stock_items').insert({ code: `W15M${sfx.slice(-6)}`, name: `Client cable ${sfx}`, unit_id: unit.id, tag_id: tag.id }).select('id, code, name').single());
    itemId = item.id;

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
    }).select('id').single()).id;
    woId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} installation`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    const site = need('site', await admin.from('stock_warehouses').insert({
      code: `W15S${sfx.slice(-6)}`, name: `Site store ${sfx}`, kind: 'site', project_id: projectId,
    }).select('id, code, name').single());
    siteId = site.id;
    await keeperOf(admin, site.id, coordinator.id);

    const total = () => page.getByTestId(`csr-total-${item.id}-${unit.code}`);

    // 1. Material coordinator opens the work order, raises a requisition for 100, and sends it to the client.
    await coordinator.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    await openWorkOrderArea(page, 'material');
    await expect(page.getByTestId('client-material-section')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('csr-empty')).toBeVisible();

    await page.getByRole('button', { name: 'New requisition' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Client reference').fill(`CL-${sfx.slice(-6)}`);
    await form.getByLabel(/^Item/).selectOption({ label: `${item.code} · ${item.name} (${unit.code})` });
    await form.getByLabel(/Take-off quantity/).fill('100');
    await form.getByLabel(/Requested quantity/).fill('100');
    await form.getByRole('button', { name: 'Create requisition' }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Send to client' }).click();
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(total().getByTestId('csr-awaiting')).toHaveText('100');

    // 2. Pickup before any client reservation is refused in plain words.
    await page.getByRole('button', { name: 'Record pickup' }).click();
    const blocked = page.getByRole('dialog');
    await blocked.getByLabel(/Quantity collected/).fill('10');
    await blocked.getByRole('button', { name: 'Record pickup' }).click();
    await expect(blocked.getByText("Nothing is reserved on this line yet. The client's reservation is recorded first.")).toBeVisible({ timeout: 15_000 });
    await blocked.getByLabel(/Quantity collected/).fill('');
    await blocked.getByRole('button', { name: 'Cancel' }).click();
    await expect(blocked).toBeHidden();

    // 3. Coordinator records the client's reservation (50), then records a pickup (30) into the site store.
    await page.getByRole('button', { name: 'Record reservation' }).click();
    const rsv = page.getByRole('dialog');
    await rsv.getByLabel(/Quantity reserved/).fill('50');
    await rsv.getByLabel(/Client's reference/).fill(`RSV-${sfx.slice(-6)}`);
    await rsv.getByRole('button', { name: 'Record reservation' }).click();
    await expect(rsv).toBeHidden({ timeout: 15_000 });
    await expect(total().getByTestId('csr-reserved')).toHaveText('50');

    await page.getByRole('button', { name: 'Record pickup' }).click();
    const pick = page.getByRole('dialog');
    await pick.getByLabel(/Quantity collected/).fill('30');
    await pick.getByLabel(/Collected by/).fill('Site Driver');
    await expect(pick.getByLabel(/Received at/)).toHaveValue(site.id);
    await pick.getByRole('button', { name: 'Record pickup' }).click();
    await expect(pick).toBeHidden({ timeout: 20_000 });

    // 4. Goal: reserved 50, collected 30, still to collect 20, awaiting 50; site stock holds 30 at zero value.
    await expect(total().getByTestId('csr-reserved')).toHaveText('50');
    await expect(total().getByTestId('csr-collected')).toHaveText('30');
    await expect(total().getByTestId('csr-still')).toHaveText('20');
    await expect(total().getByTestId('csr-awaiting')).toHaveText('50');

    const balance = await admin.rpc('get_work_order_stock_balance', { p_work_order_id: woId });
    if (balance.error) throw new Error(`balance: ${balance.error.message}`);
    const row = (balance.data as Array<Record<string, string>>).find((r) => r.item_id === item.id);
    expect(row?.on_site_qty).toBe('30');
    expect(Number(row?.on_site_value)).toBe(0);
  } finally {
    if (woId) {
      sqlAsOwner(`
        delete from client_requisition_events where requisition_id in (select id from client_requisitions where work_order_id = '${woId}');
        delete from client_requisition_pickups where requisition_id in (select id from client_requisitions where work_order_id = '${woId}');
        delete from client_requisition_lines where requisition_id in (select id from client_requisitions where work_order_id = '${woId}');
        delete from client_requisitions where work_order_id = '${woId}';
      `);
    }
    if (siteId) {
      sqlAsOwner(`
        delete from stock_ledger where warehouse_id = '${siteId}';
        delete from stock_document_lines where document_id in (select id from stock_documents where warehouse_id = '${siteId}');
        delete from stock_documents where warehouse_id = '${siteId}';
        delete from stock_balances where warehouse_id = '${siteId}';
        delete from stock_warehouse_keepers where warehouse_id = '${siteId}';
      `);
      ok('site cleanup', await svc.from('stock_warehouses').delete().eq('id', siteId));
    }
    if (woId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', woId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (tagId) ok('tag cleanup', await svc.from('stock_tags').delete().eq('id', tagId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await coordinator.cleanup();
  }
});
