// @e2e-isolation: self-isolated — creates its own disposable HR officer and HR manager logins, project, work order, crew, people and leave type per run; reads the org leave setting without mutating it, and deletes all owned rows in finally.
/**
 * JOB-H5 — HR officer submits leave on behalf of a worker, the HR manager approves, and the roster marks the days.
 * The worker has no line manager, so the request routes to the HR Managers (2260). The HR officer requests leave for a rostered
 * crew member (cannot approve their own entry); the HR manager approves it; the work-order roster marks that worker On leave
 * on both days of the leave.
 */
import { test, expect } from '@playwright/test';
import { visibleToast } from './helpers';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { jobRoleUser } from './support/jobRole';
import { orgDay } from './support/orgDay';

test.setTimeout(240_000);

test('JOB-H5 HR officer files leave for a worker, the HR manager approves it, and the roster shows On leave on both days', async ({ page }) => {
  const svc = serviceClient('JOB-H5');
  const org = need('org leave check', await svc.from('organizations').select('leave_requests_enabled').eq('id', ORG_ID).single());
  if (!org.leave_requests_enabled) {
    throw new Error('JOB-H5 precondition: leave_requests_enabled is off for this organisation (default is on)');
  }

  const run = runId('h5');
  const hrOfficer = await jobRoleUser({ service: svc, jobRole: 'hr_officer', run: runId('h5-hro') });
  const hrManager = await jobRoleUser({ service: svc, jobRole: 'hr_manager', run: runId('h5-hrm') });
  const startDay = await orgDay(3);
  const endDay = await orgDay(4);
  let projectId = '';
  let workOrderId = '';
  let crewId = '';
  let workerId = '';
  let sparePersonId = '';
  let leaveTypeId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} site work`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    leaveTypeId = need('leave type', await svc.from('leave_types').insert({
      org_id: ORG_ID, name: `${run} Annual`,
    }).select('id').single()).id;

    // Seed the worker with no line manager (so the HR Managers decide), plus a second person so the Person picker always renders.
    workerId = need('worker', await svc.from('people').insert({
      org_id: ORG_ID, code: `${run}-W1`, kind: 'own', name: `${run} Crew Worker`,
    }).select('id').single()).id;
    sparePersonId = need('spare person', await svc.from('people').insert({
      org_id: ORG_ID, code: `${run}-W2`, kind: 'own', name: `${run} Second Worker`,
    }).select('id').single()).id;

    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID, code: `H5-${Date.now().toString(36).slice(-8)}`, name: `${run} crew`, kind: 'own',
    }).select('id').single()).id;
    ok('crew member', await svc.from('crew_members').insert({
      org_id: ORG_ID, crew_id: crewId, worker_id: workerId, valid_from: await orgDay(-1),
    }));
    ok('roster', await svc.from('work_order_crews').insert({
      org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: await orgDay(-1),
    }));

    // 1. HR officer submits leave on behalf of the worker.
    await hrOfficer.signIn(page);
    await page.goto('/leave');
    await page.getByRole('button', { name: 'Request leave' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Person/).selectOption(workerId);
    await dialog.getByLabel(/^Type/).selectOption(leaveTypeId);
    await dialog.getByLabel(/^From/).fill(startDay);
    await dialog.getByLabel(/^Last day/).fill(endDay);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(visibleToast(page, 'Request sent')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Pending').first()).toBeVisible();
    // Separation of duties: the entrant cannot approve their own request.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    // 2. The HR manager opens Leave and approves the pending request.
    await hrManager.signIn(page);
    await page.goto('/leave');
    await expect(page.getByText(/Waiting for your decision/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('row', { name: new RegExp(`${run} Crew Worker`) }).first().getByRole('button', { name: 'Approve' }).click();
    await expect(visibleToast(page, 'Leave approved')).toBeVisible({ timeout: 15_000 });

    // 3. Goal: the roster marks THIS worker On leave on both days of the leave.
    for (const day of [startDay, endDay]) {
      await page.goto(`/crews?view=roster&wo=${workOrderId}&date=${day}`);
      const workerRow = page.getByRole('row').filter({ hasText: `${run} Crew Worker` });
      await expect(workerRow).toBeVisible({ timeout: 20_000 });
      await expect(workerRow.getByText('On leave')).toBeVisible({ timeout: 20_000 });
    }
  } finally {
    if (leaveTypeId) {
      sqlAsOwner(`
        delete from notifications where owner_id in ('${hrOfficer.id}', '${hrManager.id}');
        delete from leave_requests where leave_type_id = '${leaveTypeId}';
        delete from leave_types where id = '${leaveTypeId}';
      `);
    }
    if (crewId) {
      sqlAsOwner(`
        delete from work_order_crews where crew_id = '${crewId}';
        delete from crew_members where crew_id = '${crewId}';
        delete from crews where id = '${crewId}';
      `);
    }
    const personIds = [workerId, sparePersonId].filter(Boolean);
    if (personIds.length) ok('people cleanup', await svc.from('people').delete().in('id', personIds));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await hrOfficer.cleanup();
    await hrManager.cleanup();
  }
});
