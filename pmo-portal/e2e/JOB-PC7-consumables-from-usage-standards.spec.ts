// @e2e-isolation: self-isolated — owns its engineer login, project, work order, contract line (with a unique work unit no other standard matches), stock item and usage standard; archives the standard and deletes its own rows in finally.
// JOB-PC7 (project control): consumables calculated from usage standards. An administrator sets a usage standard per work unit;
// an engineer checks the standard, generates the work order's consumable plan from its 150-unit scope, and inspects the formula breakdown.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(120_000);

test('JOB-PC7 engineer generates a work order consumable plan from usage standards and verifies the calculation breakdown', async ({ page }) => {
  const svc = serviceClient('JOB-PC7');
  const run = runId('JOBPC7');
  const suffix = runSuffix();
  const engineer = await roleJobUser(svc, 'engineer', run);
  const admin = await userClient('admin@acme.test');

  // Unique work unit ensures no other organisation standard can match this work order's contract line.
  const unit = `weld${suffix.toLowerCase()}`;
  const boqCode = `WLD-${suffix}`;
  let projectId = '';
  let woIds: string[] = [];
  let boqId = '';

  try {
    const fx = await projectWithWorkOrders(svc, run, ['Welding run']);
    projectId = fx.projectId;
    woIds = fx.workOrders.map((w) => w.id);
    const wo = fx.workOrders[0];

    boqId = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID,
      project_id: projectId,
      item_code: boqCode,
      description: `${run} welding scope`,
      unit,
      quantity: 150,
      rate: 100,
    }).select('id').single()).id as string;

    ok('work order line', await svc.from('work_order_lines').insert({
      org_id: ORG_ID,
      work_order_id: wo.id,
      boq_item_id: boqId,
      quantity: 150,
    }));

    const item = await makeItem(admin, suffix, 'PC7');
    ok('usage standard', await admin.from('consumable_usage_standards').insert({
      org_id: ORG_ID,
      item_id: item.id,
      work_unit: unit,
      boq_code_prefix: 'WLD',
      qty_per_unit: 2,
      margin_pct: 0,
    }));

    await engineer.signIn(page);

    // 1. Engineer confirms the active usage standard is listed for this work unit.
    await page.goto('/stock/usage-standards');
    await page.getByLabel('Work unit').fill(unit);
    const stdRow = page.getByRole('row').filter({ hasText: unit });
    await expect(stdRow).toContainText(item.code, { timeout: 20_000 });
    await expect(stdRow).toContainText('1 lines');

    // 2. Engineer opens the work order, generates the consumable plan (150 x 2 = 300), and inspects the breakdown.
    await page.goto(`/work-orders/${wo.id}`);
    const plan = page.getByTestId('consumable-plan');
    await expect(plan).toBeVisible({ timeout: 30_000 });
    await plan.getByRole('button', { name: 'Generate plan' }).click();

    const itemRow = plan.getByTestId(`consumable-row-${item.id}`);
    await expect(itemRow).toContainText('Plan 300', { timeout: 20_000 });
    await expect(itemRow).toContainText('From standards');

    await itemRow.getByText('How this was worked out').click();
    await expect(itemRow).toContainText(`${boqCode}: 150 ${unit} x 2 per unit, +0% = 300.000`);
  } finally {
    // Usage standards are archived, never deleted (ADR-0018); this run's unique work unit keeps it isolated.
    await admin.from('consumable_usage_standards').update({ archived_at: new Date().toISOString() }).eq('work_unit', unit);
    await cleanupAll(svc, [
      ['work_order_consumable_plan_lines', 'work_order_id', woIds],
      ['work_order_lines', 'work_order_id', woIds],
      ['boq_items', 'id', boqId ? [boqId] : []],
      ['work_orders', 'id', woIds],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    await engineer.cleanup();
  }
});
