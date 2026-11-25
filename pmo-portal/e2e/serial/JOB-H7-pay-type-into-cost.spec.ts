// @e2e-isolation: serial — disconnects the seed organisation's accounting binding (restored in afterAll) and switches its labour-cost setting on for the run (restored in finally); the people, rate, project and timesheet are this run's own.
// JOB-H7 (acceptance 07-people-and-admin, TC-PA-05): pay type into cost. A person with a daily rate and a submitted timesheet:
// the Project Control Manager approves it in Approvals; the work order's labour cost rises by the day rate, and the
// timesheet shows the approved hours with no cost figure. Run with no accounting system connected.
import { test, expect } from '@playwright/test';
import { formatExactMoney } from '../../src/lib/format';
import { need, ok, ORG_ID, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { inDays, orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { disconnectSeedOrgErp, type NoErpHandle } from './noErpOrg';

test.setTimeout(180_000);

let noErp: NoErpHandle | undefined;
test.beforeAll(async () => { noErp = await disconnectSeedOrgErp(); });
test.afterAll(async () => { await noErp?.restore(); });

test('JOB-H7 approving a day for a person on a daily rate raises the work order labour cost by the day rate; the timesheet shows hours, no cost', async ({ page }) => {
  const svc = serviceClient('JOB-H7');
  const run = runId('JOBH7');
  const pcm = await roleJobUser(svc, 'project_control_manager', `${run}-pcm`);
  const worker = await roleJobUser(svc, 'engineer', `${run}-w`);
  const dayRate = 800_000;
  const day = orgToday();
  const week = inDays(-((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  const dayRateText = formatExactMoney(String(dayRate), 'USD', 'en-US')!;
  let before: { enabled: boolean } | null = null;
  let projectId = ''; let woId = ''; let classId = ''; let sheetId = ''; let rateId = '';
  try {
    before = (await svc.from('labour_cost_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle()).data;
    ok('labour switch', await svc.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: true }));
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} piling`, status: 'Ongoing Project', currency: 'USD', project_manager_id: pcm.id,
    }).select('id').single()).id as string;
    woId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pile cap`, status: 'Issued', order_value: 9_000_000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id as string;
    classId = need('labour class', await svc.from('labour_cost_classes').insert({ org_id: ORG_ID, code: `h7_${run.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-20)}`, name: `${run} crew` }).select('id').single()).id as string;
    // A day rate of 800,000 for an 8-hour day.
    rateId = need('rate', await svc.from('labour_cost_rates').insert({
      org_id: ORG_ID, subject_kind: 'person', person_id: worker.id, class_id: classId, basis: 'daily', amount: dayRate,
      overtime_multiplier: 1, day_hours: 8, month_hours: 173, effective_from: inDays(-30),
    }).select('id').single()).id as string;
    ok('line manager', await svc.from('profiles').update({ manager_id: pcm.id }).eq('id', worker.id));
    sheetId = need('timesheet', await svc.from('timesheets').insert({ org_id: ORG_ID, user_id: worker.id, week_start_date: week, status: 'Draft' }).select('id').single()).id as string;
    ok('eight hours', await svc.from('timesheet_entries').insert({ org_id: ORG_ID, timesheet_id: sheetId, project_id: projectId, work_order_id: woId, entry_date: day, hours: 8 }));
    ok('submit', await svc.from('timesheets').update({ status: 'Submitted', submitted_at: new Date().toISOString() }).eq('id', sheetId));

    await pcm.signIn(page);
    // Before approval nothing is costed.
    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('table', { name: 'Labour cost by class' })).toHaveCount(0);

    // Timesheets → Approvals: approve the day.
    await page.goto('/approvals?scope=timesheets');
    const item = page.getByRole('region', { name: 'Approvals queue' }).getByRole('button').filter({ hasText: `${run}-w` }).filter({ hasText: `${run} piling` });
    await expect(item).toBeVisible({ timeout: 30_000 });
    // The week shows its hours, with no cost figure beside them.
    await expect(item).toContainText(/8 h$/);
    await expect(item).not.toContainText(dayRateText);
    await item.click();
    await expect(page.getByRole('region', { name: 'Approval preview' })).not.toContainText(dayRateText);
    await page.getByRole('region', { name: 'Approval preview' }).getByRole('button', { name: /^approve$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^approve$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });

    // Work orders → [Work order] → Costs: labour cost is the day rate.
    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByRole('table', { name: 'Labour cost by class' })).toContainText(dayRateText, { timeout: 30_000 });

    // Approvals: the approved week moves to the approved history; the timesheet screen never carried a cost figure (checked above, before approving).
    await page.goto('/approvals?scope=timesheets');
    const history = page.locator('details').filter({ hasText: 'Approved history and corrections' });
    await expect(history).toBeAttached({ timeout: 30_000 });
    await history.evaluate((d) => { (d as HTMLDetailsElement).open = true; }); // open whether or not other approvals are pending
    await expect(page.getByText(`${run}-w`).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(dayRateText);
  } finally {
    if (sheetId) sqlAsOwner(`delete from public.timesheet_entries where timesheet_id = '${sheetId}'; delete from public.timesheets where id = '${sheetId}';`);
    if (rateId) sqlAsOwner(`delete from public.labour_cost_rates where id = '${rateId}';`);
    if (classId) sqlAsOwner(`delete from public.labour_cost_classes where id = '${classId}';`);
    if (woId) sqlAsOwner(`delete from public.work_orders where id = '${woId}';`);
    if (projectId) sqlAsOwner(`delete from public.record_changes where entity_id = '${projectId}'; delete from public.projects where id = '${projectId}';`);
    ok('restore labour switch', before ? await svc.from('labour_cost_settings').update({ enabled: before.enabled }).eq('org_id', ORG_ID) : await svc.from('labour_cost_settings').delete().eq('org_id', ORG_ID));
    await worker.cleanup();
    await pcm.cleanup();
  }
});
