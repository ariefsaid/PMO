// @e2e-isolation: serial — sets the organisation-wide attendance_target_rate to 90 for the run and restores the previous target and removes all owned rows in finally.
/**
 * JOB-H9 — HR manager records crew attendance and checks crew attendance rates against the 90% target.
 * With a 90% organisation target set and two crews rostered today (Crew A with 3 workers, Crew B with 1),
 * the HR manager ticks Crew A present for 8 hours on screen, saves attendance, then opens Attendance rate
 * and sees Crew A at 100% (meeting target) and Crew B at 0% (Below target with 1 no-record day).
 */
import { test, expect } from '@playwright/test';
import { visibleToast } from '../helpers';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(180_000);

test('JOB-H9 HR manager saves daily crew attendance and checks attendance rates against the 90% target', async ({ page }) => {
  const svc = serviceClient('JOB-H9');
  const run = runId('h9');
  const today = orgToday();
  const hrManager = await roleJobUser(svc, 'hr_manager', runId('h9-hrm'));
  const codeA = `H9A-${Date.now().toString(36).slice(-7)}`;
  const codeB = `H9B-${Date.now().toString(36).slice(-7)}`;
  let previousTarget: number | null = null;
  let targetTouched = false;
  let projectId = '';
  let workOrderId = '';
  let crewAId = '';
  let crewBId = '';
  const personIds: string[] = [];
  try {
    const org = need('target read', await svc.from('organizations').select('attendance_target_rate').eq('id', ORG_ID).single());
    previousTarget = org.attendance_target_rate === null ? null : Number(org.attendance_target_rate);
    need('target set', await svc.from('organizations').update({ attendance_target_rate: 90 }).eq('id', ORG_ID).select('id').single());
    targetTouched = true;

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe rack`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;

    crewAId = need('crew A', await svc.from('crews').insert({
      org_id: ORG_ID, code: codeA, name: `${run} Alpha`, kind: 'own',
    }).select('id').single()).id;
    crewBId = need('crew B', await svc.from('crews').insert({
      org_id: ORG_ID, code: codeB, name: `${run} Bravo`, kind: 'own',
    }).select('id').single()).id;

    for (const label of ['Worker One', 'Worker Two', 'Worker Three']) {
      const pid = need(label, await svc.from('people').insert({
        org_id: ORG_ID, kind: 'own', name: `${run} ${label}`,
      }).select('id').single()).id;
      personIds.push(pid);
      ok(`${label} placement`, await svc.from('crew_members').insert({
        org_id: ORG_ID, crew_id: crewAId, worker_id: pid, valid_from: today,
      }));
    }
    const bravoWorker = need('bravo worker', await svc.from('people').insert({
      org_id: ORG_ID, kind: 'own', name: `${run} Worker Four`,
    }).select('id').single()).id;
    personIds.push(bravoWorker);
    ok('bravo placement', await svc.from('crew_members').insert({
      org_id: ORG_ID, crew_id: crewBId, worker_id: bravoWorker, valid_from: today,
    }));

    ok('roster A', await svc.from('work_order_crews').insert({
      org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewAId, valid_from: today,
    }));
    ok('roster B', await svc.from('work_order_crews').insert({
      org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewBId, valid_from: today,
    }));

    // 1. HR manager opens daily attendance for Crew A, enters 8 hours for the crew, and saves.
    await hrManager.signIn(page);
    await page.goto(`/crews?view=attendance&wo=${workOrderId}&crew=${crewAId}`);
    await expect(page.getByRole('heading', { name: `${codeA} · ${run} Alpha` })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Hours for the crew').fill('8');
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(visibleToast(page, 'Attendance saved')).toBeVisible({ timeout: 20_000 });

    // 2. HR manager opens Attendance rate and compares both crews against the 90% target.
    await page.goto('/crews?view=rate');
    const rowA = page.getByRole('row', { name: new RegExp(codeA) });
    await expect(rowA).toBeVisible({ timeout: 20_000 });
    const cellsA = rowA.getByRole('cell');
    await expect(cellsA.nth(0)).toHaveText('3');
    await expect(cellsA.nth(1)).toHaveText('3');
    await expect(cellsA.nth(5)).toHaveText('0');
    await expect(rowA).toContainText(/100(\.00)?%/);
    await expect(rowA).toContainText('90%');
    await expect(rowA.getByText('Below target')).toHaveCount(0);

    const rowB = page.getByRole('row', { name: new RegExp(codeB) });
    await expect(rowB).toBeVisible({ timeout: 20_000 });
    const cellsB = rowB.getByRole('cell');
    await expect(cellsB.nth(0)).toHaveText('1');
    await expect(cellsB.nth(1)).toHaveText('0');
    await expect(cellsB.nth(5)).toHaveText('1');
    await expect(rowB).toContainText('0%');
    await expect(rowB).toContainText('90%');
    await expect(rowB.getByText('Below target')).toBeVisible();
  } finally {
    if (targetTouched) {
      ok('target restore', await svc.from('organizations').update({ attendance_target_rate: previousTarget }).eq('id', ORG_ID));
    }
    const crewIds = [crewAId, crewBId].filter(Boolean);
    if (crewIds.length) {
      const list = crewIds.map((id) => `'${id}'`).join(',');
      sqlAsOwner(`
        delete from attendance_days where crew_id in (${list});
        delete from work_order_crews where crew_id in (${list});
        delete from crew_members where crew_id in (${list});
        delete from crews where id in (${list});
      `);
    }
    if (personIds.length) ok('people cleanup', await svc.from('people').delete().in('id', personIds));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await hrManager.cleanup();
  }
});
