// @e2e-isolation: self-isolated — own project, work order, contract line, asset with a hire rate and approved usage; deleted in afterEach.
// JOB-PC2 (project control): a page per work order. PARTLY LANDED: the page shows scope and progress per line, costs by source, billing and
// documents. The "not done" list (progress done but no QC document, open issue) is not on the page yet — listed as missing, not asserted.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { cleanupAll, need, ok, ORG_ID, PM_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';

test.setTimeout(120_000);

let admin: SupabaseClient;
let projectId = ''; let woIds: string[] = []; let assetId = ''; let boqId = '';
test.afterEach(async () => {
  if (!admin) return;
  await cleanupAll(admin, [
    ['equipment_usage_entries', 'asset_id', assetId ? [assetId] : []],
    ['equipment_costing_settings', 'asset_id', assetId ? [assetId] : []],
    ['equipment_assets', 'id', assetId ? [assetId] : []],
    ['work_order_lines', 'work_order_id', woIds],
    ['boq_items', 'id', boqId ? [boqId] : []],
    ['work_orders', 'id', woIds],
    ['projects', 'id', projectId ? [projectId] : []],
  ]);
  projectId = ''; woIds = []; assetId = ''; boqId = '';
});

test('JOB-PC2 a project manager opens the work order page from the project and sees its scope and its costs', async ({ page }) => {
  admin = serviceClient('JOB-PC2');
  const run = runId('JOBPC2');
  const fx = await projectWithWorkOrders(admin, run, ['Pipe spool']);
  projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
  const wo = fx.workOrders[0];
  boqId = need('line', await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: 'SPOOL', description: 'Spool fabrication', unit: 'ea', quantity: 20, rate: 100 }).select('id').single()).id;
  ok('allocation', await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.id, boq_item_id: boqId, quantity: 20 }));
  assetId = need('asset', await admin.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: run, default_unit: 'hours' }).select('id').single()).id;
  ok('rate', await admin.from('equipment_costing_settings').insert({ org_id: ORG_ID, asset_id: assetId, setting_key: crypto.randomUUID(), version: 1, basis: 'hire_rate', work_rate: 100, rate_unit: 'hours', charge_category: 'Equipment', effective_from: '2026-01-01' }));
  ok('usage', await admin.from('equipment_usage_entries').insert({ org_id: ORG_ID, asset_id: assetId, project_id: projectId, work_date: '2026-11-10', quantity: 3, unit: 'hours', status: 'Approved', author_id: PM_ID, approver_id: PM_ID, approved_at: new Date().toISOString(), work_order_id: wo.id }));

  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${projectId}/contract`);
  await page.getByTestId(`wo-page-link-${wo.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/work-orders/${wo.id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(wo.number);
  await expect(page.getByTestId(`scope-line-${boqId}`)).toContainText('Spool fabrication');
  await expect(page.getByTestId('cost-group-equipment_usage')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cost-total-equipment_usage')).toContainText('300.00');
});
