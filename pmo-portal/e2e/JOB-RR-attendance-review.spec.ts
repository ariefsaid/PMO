// @e2e-isolation: self-isolated — owns its job-role user, project, crew, worker and attendance record.
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { jobRoleUser } from './support/jobRole';
import { orgDay } from './support/orgDay';

test('AC-RR-007 HR officer reviews recorded crew attendance', async ({ page }) => {
  const svc = serviceClient('JOB-RR-attendance');
  const run = runId('rr-att');
  const hr = await jobRoleUser({ service: svc, jobRole: 'hr_officer', run });
  let project = ''; let order = ''; let crew = ''; let person = '';
  try {
    const today = await orgDay();
    project = need('project', await svc.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id;
    order = need('order', await svc.from('work_orders').insert({ org_id: ORG_ID, project_id: project, title: `${run} order`, status: 'Issued', order_value: 0, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).id;
    crew = need('crew', await svc.from('crews').insert({ org_id: ORG_ID, code: `RRA-${run.slice(-7)}`, name: `${run} crew`, kind: 'own' }).select('id').single()).id;
    person = need('person', await svc.from('people').insert({ org_id: ORG_ID, kind: 'own', name: `${run} worker` }).select('id').single()).id;
    ok('placement', await svc.from('crew_members').insert({ org_id: ORG_ID, crew_id: crew, worker_id: person, valid_from: today }));
    ok('roster', await svc.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: order, crew_id: crew, valid_from: today }));
    ok('attendance', await svc.from('attendance_days').insert({ org_id: ORG_ID, project_id: project, work_order_id: order, crew_id: crew, worker_id: person, work_date: today, status: 'present', hours: 8, source: 'roster_tick' }));
    await hr.signIn(page);
    await page.goto(`/crews?view=attendance&wo=${order}`);
    const row = page.getByRole('row').filter({ hasText: `${run} worker` });
    const status = row.getByRole('combobox').first();
    await expect(status).toHaveValue('present', { timeout: 20_000 });
    await expect(status).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save attendance' })).toHaveCount(0);
  } finally {
    if (order) ok('attendance cleanup', await svc.from('attendance_days').delete().eq('work_order_id', order));
    if (crew) ok('roster cleanup', await svc.from('work_order_crews').delete().eq('crew_id', crew));
    if (crew) ok('placement cleanup', await svc.from('crew_members').delete().eq('crew_id', crew));
    if (person) ok('person cleanup', await svc.from('people').delete().eq('id', person));
    if (crew) ok('crew cleanup', await svc.from('crews').delete().eq('id', crew));
    if (order) ok('order cleanup', await svc.from('work_orders').delete().eq('id', order));
    if (project) ok('project cleanup', await svc.from('projects').delete().eq('id', project));
    await hr.cleanup();
  }
});
