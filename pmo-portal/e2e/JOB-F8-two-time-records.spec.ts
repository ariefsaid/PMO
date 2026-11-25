// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, crew, worker, roster and site report; reads the seed org and its seeded users only.
/**
 * JOB-F8 (acceptance 03-construction-site, TC-F-08): two time records for one worker and day. Ruled path: Daily reports →
 * [report] → Hours by person (not Timesheets → Approvals). The foreman's tick says 8 hours, a Project Manager adds a second
 * record of 5; the Construction Manager (who recorded neither) opens the report, sees both figures, decides, and the report
 * keeps the chosen figure with who decided and when.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { signIn, visibleToast } from './helpers';
import { markEveryonePresent } from './support/crewJourney';

test.setTimeout(180_000);

const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('JOB-F8 the Construction Manager sees both time records on the daily report and decides which stands', async ({ page }) => {
  const svc = serviceClient('JOB-F8');
  const run = runId('JOBF8');
  const cm = await roleJobUser(svc, 'construction_manager', run);
  const from = new Date(); from.setDate(from.getDate() - 7);
  let projectId: string; let workOrderId = ''; let crewId = ''; let workerId: string; let reportId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe rack`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single()).id;
    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID,
    }).select('id').single()).id;
    workerId = need('worker', await svc.from('people').insert({ org_id: ORG_ID, kind: 'own', name: `${run} Ana` }).select('id').single()).id;
    need('placement', await svc.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: workerId, valid_from: iso(from) }).select('id').single());
    need('roster', await svc.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: iso(from) }).select('id').single());

    // Precondition: a day with two different times. The foreman ticks 8 hours; a Project Manager adds a second record of 5.
    await signIn(page, 'engineer@acme.test');
    await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
    await expect(page.getByRole('row', { name: `${run} Ana` })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('textbox', { name: 'Hours for the crew' }).fill('8');
    await markEveryonePresent(page);
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 15_000 });
    const day = need('attendance day', await svc.from('attendance_days').select('work_date').eq('work_order_id', workOrderId).eq('worker_id', workerId).single());
    reportId = need('site report', await svc.from('daily_site_reports').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, work_date: day.work_date, author_id: ENGINEER_ID,
    }).select('id').single()).id;
    await signIn(page, 'pm@acme.test');
    await page.goto(`/site-reports/${reportId}`);
    const pmRow = page.getByTestId(`dsr-people-row-${workerId}`);
    await expect(pmRow).toContainText('Stands: 8 h', { timeout: 20_000 });
    await pmRow.getByRole('button', { name: 'Add second record' }).click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('5');
    await page.getByRole('button', { name: 'Save second record' }).click();
    await expect(visibleToast(page, 'Second record saved')).toBeVisible({ timeout: 15_000 });

    // The Construction Manager opens Daily reports → [report] → Hours by person.
    await cm.signIn(page);
    await page.goto('/site-reports');
    await page.goto(`/site-reports/${reportId}`);
    const hours = page.getByTestId('dsr-people-hours');
    await expect(hours.getByRole('heading', { name: 'Hours by person' })).toBeVisible({ timeout: 20_000 });
    const row = page.getByTestId(`dsr-people-row-${workerId}`);
    await expect(row).toContainText('Stands: 8 h');             // both records show
    await expect(row).toContainText('Second record: 5 h');
    await expect(row).toContainText('The two records differ');

    // Decide: the second record stands, with a reason; the report records who decided and when.
    await row.getByRole('button', { name: 'Decide' }).click();
    await page.getByRole('combobox', { name: /Which figure stands/ }).selectOption('second');
    await page.getByRole('dialog').getByRole('textbox', { name: /Why this figure stands/ }).fill('Survey sheet is signed');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(visibleToast(page, 'Decision saved')).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('Second record stands');
    await expect(row).toContainText('Survey sheet is signed');
    await expect(row).toContainText(run);                        // decider's name (the login's full name is the run id)
    const saved = need('decision', await svc.from('attendance_second_records').select('decided_by, decided_at, standing').eq('work_order_id', workOrderId).eq('worker_id', workerId).single());
    expect(saved.decided_by).toBe(cm.id);
    expect(saved.standing).toBe('second');
    expect(saved.decided_at).not.toBeNull();
  } finally {
    // decided_by points at the login, so the decision rows go first; the rest is scoped to this run's own project and crew.
    if (workOrderId) {
      ok('second records cleanup', await svc.from('attendance_second_records').delete().eq('work_order_id', workOrderId));
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      ok('roster cleanup', await svc.from('work_order_crews').update({ valid_to: iso(yesterday) }).eq('work_order_id', workOrderId));
    }
    if (crewId) ok('placements cleanup', await svc.from('crew_members').update({ valid_to: iso(new Date(Date.now() - 86_400_000)) }).eq('crew_id', crewId));
    if (reportId) ok('report cleanup', await svc.from('daily_site_reports').delete().eq('id', reportId));
    await cm.cleanup();
  }
});
