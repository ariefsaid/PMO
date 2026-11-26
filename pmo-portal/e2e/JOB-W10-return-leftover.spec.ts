// @e2e-isolation: self-isolated — creates its own disposable storekeeper login, item, site location and work item per run, and deletes all owned rows in finally.
/** JOB-W10 — a closing job's leftover material is returned by the site supervisor to the warehouse; the warehouse balance rises back to 10, the
 *  ledger carries the return, and the work order's own stock balance falls (4 issued to it, 0 after the return). */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { keeperOf, makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, SEED_PROJECT_ID, SEED_PROJECT_NAME, userClient } from './support/stockFixture';
import { label } from './support/jobStock';

test.setTimeout(180_000);

test('JOB-W10 site supervisor returns 4 leftover units and the warehouse reads 10 again', async ({ page }) => {
  const svc = serviceClient('JOB-W10');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const storekeeper = await roleJobUser(svc, 'site_supervisor', runId('w10-sv')) // step 110 is the site supervisor's; an Admin names them keeper of the site store;
  let itemId = '';
  let unitId = '';
  let siteId = '';
  const workOrderId = randomUUID();
  let workOrderMade = false;
  const docIds: string[] = [];
  try {
    const item = await makeItem(admin, sfx, 'RET');
    itemId = item.id;
    unitId = need('unit', await svc.from('stock_items').select('unit_id').eq('id', item.id).single()).unit_id;
    const site = await makeWarehouse(admin, sfx, 'SITE', 'site');
    siteId = site.id;
    await keeperOf(admin, site.id, storekeeper.id);
    const work = await makeWorkItem(admin, sfx);
    docIds.push(await postReceive(admin, site.id, item.id, '10', '25'));
    const project = need('project', await svc.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single());
    ok('work order', await svc.from('work_orders').insert({ id: workOrderId, org_id: project.org_id, project_id: SEED_PROJECT_ID,
      title: `Leftover work ${sfx}`, wo_number: `WO-W10-${sfx}`, status: 'Issued', issued_at: new Date().toISOString(),
      order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.currency }));
    workOrderMade = true;
    const issued = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: site.id, project_id: SEED_PROJECT_ID, work_order_id: workOrderId }, p_lines: [{ item_id: item.id, quantity: '4', boq_item_id: work.id }], p_post: true });
    if (issued.error) throw issued.error;
    docIds.push(issued.data as string);
    // The work order is named by the cost attribution (as the issue form does right after it saves), not by the document header.
    ok('issue attribution', await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [issued.data], p_work_order_id: workOrderId, p_discipline_id: null }));

    // 0. The work order's own stock balance, before the return: 4 issued to it.
    const woBalance = async () => {
      await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
      const card = page.getByTestId(`customer-order-${workOrderId}`);
      await card.getByRole('button', { name: 'Stock for this work order' }).click();
      return card.getByRole('row').filter({ hasText: site.code }).getByRole('cell').nth(4);
    };
    await signIn(page, 'admin@acme.test');
    await expect(await woBalance()).toHaveText(/^4\b/, { timeout: 20_000 });

    // 1. Storekeeper returns the 4 leftover units from the site store to the project.
    await storekeeper.signIn(page);
    await page.goto('/stock/new/return');
    await page.getByLabel(/^Warehouse/).selectOption({ label: label(site) });
    await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
    // The picker lists every posted issue on the shared seed project; cite this run's own issue, never a position.
    const source = page.getByLabel(/^Issue to return/);
    const own = source.locator('option', { hasText: item.code });
    await expect(own).toHaveCount(1, { timeout: 15_000 });
    await source.selectOption(await own.getAttribute('value') ?? '');
    await page.getByLabel(/^Quantity/).fill('4');
    await page.getByRole('button', { name: 'Post stock return' }).click();
    await page.getByRole('dialog', { name: 'Post this stock return?' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    docIds.push(page.url().split('/').pop() ?? '');

    // 2. Goal: the return is on the ledger and the site store reads 10 again.
    await page.goto(`/stock/ledger?item=${item.id}`);
    await expect(page.getByRole('row').filter({ hasText: 'Return' }).first(), 'the return is on the ledger').toBeVisible({ timeout: 15_000 });
    await page.goto('/stock');
    await page.getByPlaceholder('Search items').fill(item.code);
    // The on-hand quantity cell itself, not any digit in the row's text.
    await expect(page.getByRole('row').filter({ hasText: item.code }).filter({ hasText: site.name }).locator('span.tabular-nums').first()).toHaveText(/^10(?:[.,]0+)?(?:\s|$)/);
    // ...and the work order's balance falls: the 4 issued to it are returned, so it holds 0.
    await signIn(page, 'admin@acme.test');
    await expect(await woBalance()).toHaveText(/^0\b/, { timeout: 20_000 });
  } finally {
    const ids = docIds.filter(Boolean);
    if (ids.length) {
      const list = ids.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`delete from stock_ledger where document_id in (${list}); delete from stock_document_lines where document_id in (${list}); delete from stock_documents where id in (${list});`);
    }
    if (workOrderMade) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (siteId) {
      sqlAsOwner(`delete from stock_balances where warehouse_id = '${siteId}'; delete from stock_warehouse_keepers where warehouse_id = '${siteId}';`);
      ok('location cleanup', await svc.from('stock_warehouses').delete().eq('id', siteId));
    }
    ok('work item cleanup', await svc.from('boq_items').delete().eq('project_id', SEED_PROJECT_ID).eq('item_code', `E2E-W${sfx}`));
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await storekeeper.cleanup();
  }
});
