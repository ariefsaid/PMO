// @e2e-isolation: self-isolated — owns its Executive login, project, two work orders, plan lines, one asset with a hire rate and approved usage; deletes them in afterEach.
// JOB-M1 (acceptance 01-management, TC-M-01): profit per project and per work order. The company's Executive opens the
// project's Work orders tab; each work order shows its planned direct cost, its posted actual cost and the difference,
// and the project total carries the sum of the rows plus the shared (indirect) plan.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupAll, cleanupEquipment, equipmentCost, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient, type EquipmentCostFixture } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
let admin: SupabaseClient;
let actor: Actor | undefined;
let projectId = ''; let woIds: string[] = []; let equipment: EquipmentCostFixture | undefined;

test.afterEach(async () => {
  if (!admin) return;
  await cleanupEquipment(admin, equipment);
  await cleanupAll(admin, [
    ['work_order_plan_lines', 'work_order_id', woIds],
    ['work_orders', 'id', woIds],
    ['projects', 'id', projectId ? [projectId] : []],
  ]);
  await actor?.cleanup();
  projectId = ''; woIds = []; equipment = undefined; actor = undefined;
});

test('JOB-M1 the Executive sees plan, actual and the difference per work order, and the project total adds the shared cost', async ({ page }) => {
  admin = serviceClient('JOB-M1');
  const run = runId('JOBM1');
  actor = await roleJobUser(admin, 'executive', run);
  const fx = await projectWithWorkOrders(admin, run, ['Pipe spool', 'Tank wall']);
  projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
  const [a, b] = fx.workOrders;

  // Plan: A 400.00 direct (will use 300.00), B 150.00 direct (will use 200.00), and 100.00 shared (indirect) on A.
  ok('plan A', await admin.from('work_order_plan_lines').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: a.id, kind: 'direct_budget', value: 400 }));
  ok('plan B', await admin.from('work_order_plan_lines').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: b.id, kind: 'direct_budget', value: 150 }));
  ok('shared plan', await admin.from('work_order_plan_lines').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: a.id, kind: 'indirect_budget', value: 100 }));
  // Actual: a machine at 100.00 an hour, 3 h on A and 2 h on B, both approved.
  equipment = await equipmentCost(admin, run, projectId, 100, [{ woId: a.id, day: '2026-11-10', hours: 3 }, { woId: b.id, day: '2026-11-11', hours: 2 }]);

  await actor.signIn(page);
  await page.goto(`/projects/${projectId}/orders`);
  const pva = page.getByTestId('wo-plan-vs-actual');
  const rowA = pva.getByTestId(`wo-pva-row-${a.id}`);
  const rowB = pva.getByTestId(`wo-pva-row-${b.id}`);
  await expect(rowA).toBeVisible({ timeout: 30_000 });
  await expect(rowA.getByTestId('wo-pva-plan-direct')).toHaveText('$400');     // plan
  await expect(rowA.getByTestId('wo-pva-direct')).toHaveText('$300');          // actual
  await expect(rowA.getByTestId('wo-pva-difference')).toHaveText('$100 left'); // difference
  await expect(rowB.getByTestId('wo-pva-plan-direct')).toHaveText('$150');
  await expect(rowB.getByTestId('wo-pva-direct')).toHaveText('$200');
  await expect(rowB.getByTestId('wo-pva-difference')).toHaveText('Over plan by $50');
  const total = pva.getByTestId('wo-pva-total-USD');
  await expect(total).toContainText('$550');         // 400 + 150 planned direct: the sum of the rows
  await expect(total).toContainText('$500');         // 300 + 200 actual: the sum of the rows
  await expect(total).toContainText('$100');         // the shared leg's plan reaches the project total
});
