// @e2e-isolation: self-isolated — creates its own project, two work orders, one asset with a hire rate and approved usage; deletes them in afterEach.
// JOB-M1 (management): profit per project with plan against actual per work order. The director opens the project's contract area; each work order
// shows its planned direct cost, its actual direct cost and the difference, and the project total equals the sum of the rows.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { cleanupAll, need, ok, ORG_ID, PM_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';

test.setTimeout(120_000);

let admin: SupabaseClient;
let projectId = ''; let woIds: string[] = []; let assetId = ''; let settingKey = '';

test.afterEach(async () => {
  if (!admin) return;
  await cleanupAll(admin, [
    ['work_order_plan_lines', 'work_order_id', woIds],
    ['equipment_usage_entries', 'asset_id', assetId ? [assetId] : []],
    ['equipment_costing_settings', 'asset_id', assetId ? [assetId] : []],
    ['equipment_assets', 'id', assetId ? [assetId] : []],
    ['work_orders', 'id', woIds],
    ['projects', 'id', projectId ? [projectId] : []],
  ]);
  projectId = ''; woIds = []; assetId = '';
});

test('JOB-M1 the director sees plan, actual and the difference per work order, and the project total is the sum', async ({ page }) => {
  admin = serviceClient('JOB-M1');
  const run = runId('JOBM1');
  const fx = await projectWithWorkOrders(admin, run, ['Pipe spool', 'Tank wall']);
  projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
  const [a, b] = fx.workOrders;

  // Plan: A 400.00 direct (will use 300.00), B 150.00 direct (will use 200.00).
  ok('plan A', await admin.from('work_order_plan_lines').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: a.id, kind: 'direct_budget', value: 400 }));
  ok('plan B', await admin.from('work_order_plan_lines').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: b.id, kind: 'direct_budget', value: 150 }));
  // Actual: a machine at 100.00 an hour, 3 h on A and 2 h on B, both approved.
  assetId = need('asset', await admin.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: run, default_unit: 'hours' }).select('id').single()).id;
  settingKey = crypto.randomUUID();
  ok('rate', await admin.from('equipment_costing_settings').insert({
    org_id: ORG_ID, asset_id: assetId, setting_key: settingKey, version: 1, basis: 'hire_rate', work_rate: 100, rate_unit: 'hours', charge_category: 'Equipment', effective_from: '2026-01-01',
  }));
  for (const [wo, day, qty] of [[a.id, '2026-11-10', 3], [b.id, '2026-11-11', 2]] as const) {
    ok('usage', await admin.from('equipment_usage_entries').insert({
      org_id: ORG_ID, asset_id: assetId, project_id: projectId, work_date: day, quantity: qty, unit: 'hours', status: 'Approved',
      author_id: PM_ID, approver_id: PM_ID, approved_at: new Date().toISOString(), work_order_id: wo,
    }));
  }

  await signIn(page, 'exec@acme.test');
  await page.goto(`/projects/${projectId}/contract`);
  const pva = page.getByTestId('wo-plan-vs-actual');
  const rowA = pva.getByTestId(`wo-pva-row-${a.id}`);
  const rowB = pva.getByTestId(`wo-pva-row-${b.id}`);
  await expect(rowA).toBeVisible({ timeout: 30_000 });
  await expect(rowA).toContainText('400.00');          // plan
  await expect(rowA.getByTestId('wo-pva-direct')).toContainText('300.00');   // actual
  await expect(rowA.getByTestId('wo-pva-direct')).toContainText('100.00 left'); // difference
  await expect(rowB).toContainText('150.00');
  await expect(rowB.getByTestId('wo-pva-direct')).toContainText('200.00');
  await expect(rowB.getByTestId('wo-pva-direct')).toContainText('Over plan by 50.00');
  const total = pva.getByTestId('wo-pva-total-USD');
  await expect(total).toContainText('550.00');         // 400 + 150 planned
  await expect(total).toContainText('500.00');         // 300 + 200 actual
});
