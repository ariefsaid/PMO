// @e2e-isolation: self-isolated — own project, work order, contract line, allowance and stock item (a unique code; stock rows are append-only and stay); the request chain is set by this journey as AC-MRQ-015 does.
// JOB-PC24 (material person): a request above the plan carries a reason and goes first to the plan-check step. Plan 100, request 120.
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { makeItem, runSuffix, userClient } from './support/stockFixture';
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, serviceClient } from './support/jobFixtures';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(180_000);

let admin: SupabaseClient;
let projectId = ''; let woIds: string[] = []; let boqId = ''; let requestId = '';
test.afterEach(async () => {
  if (!admin) return;
  if (requestId) await admin.from('material_requests').delete().eq('id', requestId); // steps, lines and events cascade or stay as history
  await cleanupAll(admin, [
    ['boq_material_allowances', 'boq_item_id', boqId ? [boqId] : []],
    ['work_order_lines', 'work_order_id', woIds],
    ['boq_items', 'id', boqId ? [boqId] : []],
    ['work_orders', 'id', woIds],
    ['projects', 'id', projectId ? [projectId] : []],
  ]).catch(() => undefined); // request history may pin the work order; the unique run name keeps reruns clean
  projectId = ''; woIds = []; boqId = ''; requestId = '';
});

async function pick(page: Page, label: RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test('JOB-PC24 a request of 120 against a plan of 100 asks for a reason and waits at the first step', async ({ page }) => {
  admin = serviceClient('JOB-PC24');
  const sfx = runSuffix();
  const fx = await projectWithWorkOrders(admin, `JOBPC24-${sfx}`, ['Concrete']);
  projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
  const wo = fx.workOrders[0];
  const adminUser = await userClient('admin@acme.test');
  ok('site location', await admin.from('stock_warehouses').insert({ code: `E2E-S${sfx}`, name: `E2E site ${sfx}`, kind: 'site', project_id: projectId, org_id: ORG_ID })); // a request needs a delivery location on its project
  const item = await makeItem(adminUser, sfx, 'P');
  boqId = need('line', await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: 'CONC', description: 'Concrete', unit: 'm3', quantity: 100, rate: 10 }).select('id').single()).id;
  ok('allocation', await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.id, boq_item_id: boqId, quantity: 100 }));
  ok('allowance', await admin.from('boq_material_allowances').insert({ org_id: ORG_ID, boq_item_id: boqId, item_id: item.id, planned_quantity: 100 }));
  ok('chain', await adminUser.rpc('mrq_set_chain', { p_steps: [{ role: 'Project Manager', label: 'Plan check', only_over_plan: false }] }));

  await signIn(page, 'engineer@acme.test');
  await page.goto('/material-requests/new');
  await pick(page, /^project/i, `JOBPC24-${sfx} project`);
  await pick(page, /^work order/i, `${wo.number} · ${wo.title}`);
  await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
  await page.getByLabel(/^quantity/i).fill('120');
  await expect(page.getByTestId('mrq-plan')).toContainText('Over plan');
  await expect(page.getByTestId('mrq-plan')).toContainText('100');

  // No reason: refused. With a reason: sent, and it waits at the plan-check step.
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText(/give a reason/i)).toBeVisible();
  await page.getByLabel(/why do you need more than the plan/i).fill('Extra pour on the east slab');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  requestId = page.url().split('/').pop() ?? '';
  await expect(page.getByTestId('mrq-chain')).toContainText('Plan check');
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  await expect(page.getByText(/Over plan: Extra pour on the east slab/)).toBeVisible();
});
