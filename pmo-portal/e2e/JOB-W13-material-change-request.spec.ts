// @e2e-isolation: self-isolated — creates its own field and engineer logins, project, work order, contract line, allowance, site location and item per run; the request chain is set by this journey, as the other material-request journeys do.
/** JOB-W13 — material change request: against a plan of 100 the requester asks for 120 with a reason, and the request routes to the engineer's
 *  approval step. */
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, makeWarehouse, runSuffix, userClient } from './support/stockFixture';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(240_000);

let admin: SupabaseClient;
let projectId = ''; let woIds: string[] = []; let boqId = ''; let requestId = ''; let warehouseId = '';

const pick = async (page: Page, label: RegExp, option: string | RegExp) => {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
};

test.afterEach(async () => {
  if (!admin) return;
  if (requestId) await admin.from('material_requests').delete().eq('id', requestId).then(() => undefined); // steps, lines and events cascade or stay as history
  await cleanupAll(admin, [
    ['boq_material_allowances', 'boq_item_id', boqId ? [boqId] : []],
    ['work_order_lines', 'work_order_id', woIds],
    ['boq_items', 'id', boqId ? [boqId] : []],
    ['work_orders', 'id', woIds],
    ['stock_warehouses', 'id', warehouseId ? [warehouseId] : []],
    ['projects', 'id', projectId ? [projectId] : []],
  ]).catch(() => undefined); // request history may pin the work order; the unique run name keeps reruns clean
  projectId = ''; woIds = []; boqId = ''; requestId = ''; warehouseId = '';
});

test('JOB-W13 the requester asks 120 against a plan of 100 with a reason and it routes to the engineer', async ({ page }) => {
  admin = serviceClient('JOB-W13');
  const sfx = runSuffix();
  const requester = await roleJobUser(admin, 'field_user', runId('w13-req'));
  const engineer = await roleJobUser(admin, 'engineer', runId('w13-eng'));
  const adminUser = await userClient('admin@acme.test');
  try {
    const fx = await projectWithWorkOrders(admin, `JOBW13-${sfx}`, ['Concrete']);
    projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
    const wo = fx.workOrders[0];
    const site = await makeWarehouse(adminUser, sfx, 'S', 'site', projectId); // a request needs a delivery location on its project
    warehouseId = site.id;
    const item = await makeItem(adminUser, sfx, 'P');
    boqId = need('line', await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: 'CONC', description: 'Concrete', unit: 'm3', quantity: 100, rate: 10 }).select('id').single()).id;
    ok('allocation', await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.id, boq_item_id: boqId, quantity: 100 }));
    ok('allowance', await admin.from('boq_material_allowances').insert({ org_id: ORG_ID, boq_item_id: boqId, item_id: item.id, planned_quantity: 100 }));
    // The Admin names the engineer job role as the step that decides a change over the plan.
    ok('chain', await adminUser.rpc('mrq_set_chain', { p_steps: [{ role: 'Engineer', label: 'Engineer check', job_role: 'engineer', only_over_plan: false }] }));

    // 1. The requester opens a new request against the work order and asks for 120.
    await requester.signIn(page);
    await expect(page).toHaveURL(/\/my$/, { timeout: 20_000 });
    await page.goto('/material-requests/new');
    await pick(page, /^project/i, `JOBW13-${sfx} project`);
    await pick(page, /^work order/i, `${wo.number} · ${wo.title}`);
    await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
    await page.getByLabel(/^quantity/i).fill('120');
    await expect(page.getByTestId('mrq-plan')).toContainText('Over plan');
    await expect(page.getByTestId('mrq-plan')).toContainText('100');

    // 2. No reason is refused; with the reason the request goes to the engineer.
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.getByText(/give a reason/i)).toBeVisible();
    await page.getByLabel(/why do you need more than the plan/i).fill('Extra pour on the east slab');
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    requestId = page.url().split('/').pop() ?? '';
    await expect(page.getByTestId('mrq-chain')).toContainText('Engineer check');
    await expect(page.getByText(/Over plan: Extra pour on the east slab/)).toBeVisible();

    // 3. Goal: it is the engineer's to decide — it is in that role's waiting queue.
    await engineer.signIn(page);
    await page.goto('/material-requests');
    await page.getByRole('tab', { name: /Waiting for me/ }).click();
    const row = page.getByRole('row').filter({ hasText: 'Engineer check' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('Step 1: Engineer check');
  } finally {
    await requester.cleanup().catch(() => undefined);
    await engineer.cleanup().catch(() => undefined);
  }
});
