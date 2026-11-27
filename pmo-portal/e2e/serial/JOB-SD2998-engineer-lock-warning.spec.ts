// @e2e-isolation: serial — the work-order safety section only renders while the organisation-wide safety-records switch is on; the spec sets it for the run and restores the prior value. It owns its project, crew, people and safety rows, deleted in finally.
/**
 * JOB-SD2998 — safety day lock warning (#2998). An Engineer (who may enter and submit safety days, but whose row rules often show no attendance) starts
 * today's record for a crew already present. Goal oracle: the header and the lock dialog both name the unchecked present workers before the lock is refused.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { openWorkOrderArea } from '../support/workOrderArea';

test.setTimeout(180_000);

test('JOB-SD2998 an Engineer locking a safety day is told which present workers still need a fitness check', async ({ page }) => {
  const svc = serviceClient('JOB-SD2998');
  const run = runId('sd2998');
  const engineer = await roleJobUser(svc, 'safety_officer', runId('sd2998-eng'), 'Engineer');
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
    crewId = need('crew', await svc.from('crews').insert({ org_id: ORG_ID, code: `SD2998-${run.slice(-8)}`, name: `${run} crew` }).select('id').single()).id;
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
    await engineer.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'documents');
    await page.getByTestId('safety-section').getByTestId('safety-new-day').click();
    await expect(page).toHaveURL(/\/safety-days\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // 2. Nothing is checked yet: the header and the lock dialog name the same two present workers.
    await expect(page.getByTestId('safety-missing')).toContainText('Fitness check', { timeout: 20_000 });
    await page.getByTestId('safety-submit').click();
    const unchecked = page.getByTestId('safety-lock-unchecked');
    await expect(unchecked).toContainText(`${run} Worker A`, { timeout: 15_000 });
    await expect(unchecked).toContainText(`${run} Worker B`);
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
    await engineer.cleanup();
  }
});
