// @e2e-isolation: serial — the work-order safety section only renders while the organisation-wide safety-records switch is on; the spec sets it for the run and restores the prior value. It owns its project, crew, people and safety rows, deleted in finally.
/**
 * JOB-F23 — daily check-up (#2596). The safety officer records today's fitness check for the crew rostered on a work order.
 * Goal oracle: the checks show on that day's safety record, reached from the work order.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { openWorkOrderArea } from '../support/workOrderArea';

test.setTimeout(180_000);

test('JOB-F23 the safety officer records the crew\'s daily check-up and it shows on the day\'s safety record', async ({ page }) => {
  const svc = serviceClient('JOB-F23');
  const run = runId('f23');
  const safetyOfficer = await roleJobUser(svc, 'safety_officer', runId('f23-so'));
  const today = orgToday();
  let switchBefore: boolean | null = null;
  let switchTouched = false;
  let projectId = '';
  let workOrderId = '';
  let crewId = '';
  let personIds: string[] = [];
  try {
    const org = need('org switch read', await svc.from('organizations').select('safety_records_enabled').eq('id', ORG_ID).single());
    switchBefore = Boolean(org.safety_records_enabled);
    ok('org switch on', await svc.from('organizations').update({ safety_records_enabled: true }).eq('id', ORG_ID));
    switchTouched = true;

    projectId = need('project', await svc.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe run`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    crewId = need('crew', await svc.from('crews').insert({ org_id: ORG_ID, code: `F23-${run.slice(-8)}`, name: `${run} crew` }).select('id').single()).id;
    const people = need('people', await svc.from('people').insert([
      { org_id: ORG_ID, code: `${run}-A`, name: `${run} Worker A` },
      { org_id: ORG_ID, code: `${run}-B`, name: `${run} Worker B` },
    ]).select('id'));
    personIds = (people as { id: string }[]).map((p) => p.id);
    ok('members', await svc.from('crew_members').insert(personIds.map((worker_id) => ({ org_id: ORG_ID, crew_id: crewId, worker_id, valid_from: '2020-01-01' }))));
    ok('roster', await svc.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: '2020-01-01' }));
    ok('attendance', await svc.from('attendance_days').insert(personIds.map((worker_id) => ({
      org_id: ORG_ID, worker_id, work_order_id: workOrderId, project_id: projectId, work_date: today, status: 'present', hours: 8, source: 'manual_correction',
    }))));

    // 1. The safety officer starts today's record from the work order.
    await safetyOfficer.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'documents');
    await page.getByTestId('safety-section').getByTestId('safety-new-day').click();
    await expect(page).toHaveURL(/\/safety-days\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // 2. The daily check-up: every rostered worker checked and fit.
    await page.getByRole('button', { name: 'Mark all crew members fit' }).click();
    await expect(page.getByTestId('safety-fitness-row')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByTestId('safety-fitness')).toContainText(`${run} Worker A`);
    await expect(page.getByTestId('safety-fitness')).toContainText(`${run} Worker B`);
    await expect(page.getByTestId('safety-fitness-row').first()).toContainText('Fit');

    // 3. Goal: the check-up shows on that day's safety record as reached from the work order.
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'documents');
    const todayRow = page.locator(`[data-testid="safety-day-row"][data-date="${today}"]`);
    await expect(todayRow).toBeVisible({ timeout: 20_000 });
    await todayRow.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('safety-fitness-row')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByTestId('safety-fitness-row').first()).toContainText('Fit');
  } finally {
    if (workOrderId) {
      ok('safety days cleanup', await svc.from('safety_days').delete().eq('work_order_id', workOrderId));
      ok('attendance cleanup', await svc.from('attendance_days').delete().eq('work_order_id', workOrderId));
      ok('roster cleanup', await svc.from('work_order_crews').delete().eq('work_order_id', workOrderId));
    }
    if (crewId) {
      ok('members cleanup', await svc.from('crew_members').delete().eq('crew_id', crewId));
      ok('crew cleanup', await svc.from('crews').delete().eq('id', crewId));
    }
    if (personIds.length) ok('people cleanup', await svc.from('people').delete().in('id', personIds));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    if (switchTouched) ok('org switch restore', await svc.from('organizations').update({ safety_records_enabled: switchBefore ?? false }).eq('id', ORG_ID));
    await safetyOfficer.cleanup();
  }
});
