// @e2e-isolation: self-isolated — owns its project-control-manager login, project, work order and timesheet; deletes them in finally.
// JOB-PC3 (project control): a plan per work order. The project control manager enters direct-budget, equipment-hours and crew-hours plans on a released
// work order belonging to another manager's project; the plan shows beside zero actuals, and an approved timesheet raises the crew-hours actual.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, PM_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

test('JOB-PC3 project control manager saves a direct and hour plan on a work order, and approved hours raise the actual', async ({ page }) => {
  const admin = serviceClient('JOB-PC3');
  const run = runId('JOBPC3');
  const pcm = await roleJobUser(admin, 'project_control_manager', run);

  let projectId = '';
  let woIds: string[] = [];
  let timesheetId = '';

  try {
    const fx = await projectWithWorkOrders(admin, run, ['Hydrotest']);
    projectId = fx.projectId;
    woIds = fx.workOrders.map((w) => w.id);
    const wo = fx.workOrders[0];

    await pcm.signIn(page);
    await page.goto(`/projects/${projectId}/orders`);
    const row = page.getByTestId(`wo-pva-row-${wo.id}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Nothing planned and nothing spent yet: the block says so once and offers Plan on the row.
    await expect(page.getByTestId('wo-pva-nothing-yet')).toBeVisible();

    await row.getByRole('button', { name: /^plan$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^direct budget/i).fill('500');
    await dialog.getByLabel(/equipment hours/i).fill('10');
    await dialog.getByLabel(/crew hours/i).fill('40');
    await dialog.getByRole('button', { name: /save plan/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    // The plan shows beside zero actuals: the direct plan in the work order's row, the hour plans in the hours table.
    await expect(row.getByTestId('wo-pva-plan-direct')).toHaveText('$500');
    await expect(row.getByTestId('wo-pva-direct')).toHaveText('$0');
    const hours = page.getByTestId('wo-pva-project-hours');
    await expect(hours.getByTestId('wo-pva-hours-plan-equipment')).toHaveText('10');
    await expect(hours.getByTestId('wo-pva-hours-equipment')).toHaveText('0');
    await expect(hours.getByTestId('wo-pva-hours-plan-crew')).toHaveText('40');
    await expect(hours.getByTestId('wo-pva-hours-crew')).toHaveText('0');

    // An approved timesheet of 8 h on the work order raises the crew-hours actual beside the plan.
    const ts = need('timesheet', await admin.from('timesheets').insert({
      org_id: ORG_ID,
      user_id: PM_ID,
      week_start_date: '2025-03-03',
      status: 'Approved',
      approved_by: PM_ID,
      approved_at: new Date().toISOString(),
    }).select('id').single());
    timesheetId = ts.id;
    ok('entry', await admin.from('timesheet_entries').insert({
      org_id: ORG_ID,
      timesheet_id: timesheetId,
      project_id: projectId,
      entry_date: '2025-03-04',
      hours: 8,
      work_order_id: wo.id,
    }));

    await page.reload();
    await expect(page.getByTestId('wo-pva-project-hours').getByTestId('wo-pva-hours-crew')).toHaveText('8', { timeout: 30_000 });
    await expect(page.getByTestId('wo-pva-project-hours').getByTestId('wo-pva-hours-plan-crew')).toHaveText('40');
  } finally {
    await cleanupAll(admin, [
      ['timesheets', 'id', timesheetId ? [timesheetId] : []],
      ['work_order_plan_lines', 'work_order_id', woIds],
      ['work_orders', 'id', woIds],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    await pcm.cleanup();
  }
});
