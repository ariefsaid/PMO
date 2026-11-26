// @e2e-isolation: self-isolated — creates its own disposable site supervisor, project, work order, crew, person and approved attendance row; removes every row by its exact id.
/**
 * JOB-Q1 — the site supervisor opens the work order they are responsible for and reads its costs (#2922). The approved
 * attendance day of a crew member on that work order shows as an Attendance line under Costs: the cost read still hands the
 * supervisor the lines their job covers.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { inDays } from './support/jobJourney';
import { openWorkOrderArea } from './support/workOrderArea';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-Q1 the supervisor of a work order sees its approved attendance day under Costs', async ({ page }) => {
  const svc = serviceClient('JOB-Q1');
  const run = runId('q1');
  const supervisor = await roleJobUser(svc, 'site_supervisor', runId('q1-ss'));
  let projectId = ''; let workOrderId = ''; let crewId = ''; let personId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD',
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
      responsible_person_id: supervisor.id, start_date: inDays(-2), end_date: inDays(5),
    }).select('id').single()).id;
    crewId = need('crew', await svc.from('crews').insert({ org_id: ORG_ID, code: `Q1-${run.slice(-8)}`, name: `${run} crew`, kind: 'own' }).select('id').single()).id;
    personId = need('person', await svc.from('people').insert({ org_id: ORG_ID, kind: 'own', name: `${run} Ana` }).select('id').single()).id;
    ok('placement', await svc.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: personId, valid_from: inDays(-2) }));
    ok('roster', await svc.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: inDays(-2) }));
    ok('attendance', await svc.from('attendance_days').insert({
      org_id: ORG_ID, worker_id: personId, crew_id: crewId, work_order_id: workOrderId, project_id: projectId, work_date: inDays(-1),
      status: 'present', hours: 8, source: 'roster_tick', recorded_by: supervisor.id, approved_by: supervisor.id, approved_at: new Date().toISOString(),
    }));

    await supervisor.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'cost');
    const costs = page.getByRole('heading', { name: 'Costs' }).locator('xpath=ancestor::section[1]');
    await expect(costs).toBeVisible({ timeout: 20_000 });
    // Goal: the approved day of the crew member is on the supervisor's own work order costs.
    await expect(costs.getByText('Attendance', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    if (workOrderId) ok('attendance cleanup', await svc.from('attendance_days').delete().eq('work_order_id', workOrderId));
    if (crewId) ok('roster cleanup', await svc.from('work_order_crews').delete().eq('crew_id', crewId));
    if (crewId) ok('placement cleanup', await svc.from('crew_members').delete().eq('crew_id', crewId));
    if (personId) ok('person cleanup', await svc.from('people').delete().eq('id', personId));
    if (crewId) ok('crew cleanup', await svc.from('crews').delete().eq('id', crewId));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await supervisor.cleanup();
  }
});
