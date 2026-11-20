// @e2e-isolation: self-isolated — creates its own project, work order and timesheet; deletes them in afterEach.
// JOB-PC3 (project control): a plan per work order. The project manager enters a direct-budget and crew-hours plan on a released work order;
// the plan shows beside an actual of zero, and a posted timesheet raises the crew-hours actual.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { cleanupAll, need, ok, ORG_ID, PM_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';

test.setTimeout(120_000);

let admin: SupabaseClient;
let projectId = ''; let woIds: string[] = []; let timesheetId = '';

test.afterEach(async () => {
  if (!admin) return;
  await cleanupAll(admin, [
    ['timesheets', 'id', timesheetId ? [timesheetId] : []],
    ['work_order_plan_lines', 'work_order_id', woIds],
    ['work_orders', 'id', woIds],
    ['projects', 'id', projectId ? [projectId] : []],
  ]);
  projectId = ''; woIds = []; timesheetId = '';
});

test('JOB-PC3 a plan saved on a released work order shows beside zero actuals, and a posted timesheet raises the crew-hours actual', async ({ page }) => {
  admin = serviceClient('JOB-PC3');
  const run = runId('JOBPC3');
  const fx = await projectWithWorkOrders(admin, run, ['Hydrotest']);
  projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
  const wo = fx.workOrders[0];

  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${projectId}/contract`);
  const row = page.getByTestId(`wo-pva-row-${wo.id}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('No plan');

  await row.getByRole('button', { name: /^plan$/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/direct budget/i).fill('500');
  await dialog.getByLabel(/crew hours/i).fill('40');
  await dialog.getByRole('button', { name: /save plan/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

  await expect(row).toContainText('500.00');                                  // the plan
  await expect(row.getByTestId('wo-pva-direct')).toContainText('0.00');       // the actual, still zero
  await row.getByRole('button', { name: /basis/i }).click();
  await expect(page.getByTestId('wo-pva-project-hours')).toContainText(/Crew hours\s*0 · Plan: 40/);

  // A posted timesheet of 8 h on the work order raises the crew-hours actual.
  const ts = need('timesheet', await admin.from('timesheets').insert({ org_id: ORG_ID, user_id: PM_ID, week_start_date: '2026-11-09', status: 'Approved', approved_by: PM_ID, approved_at: new Date().toISOString() }).select('id').single());
  timesheetId = ts.id;
  ok('entry', await admin.from('timesheet_entries').insert({ org_id: ORG_ID, timesheet_id: timesheetId, project_id: projectId, entry_date: '2026-11-10', hours: 8, work_order_id: wo.id }));
  await page.reload();
  await expect(page.getByTestId('wo-pva-project-hours')).toContainText(/Crew hours\s*8 · Plan: 40/, { timeout: 30_000 });
});
