// @e2e-isolation: self-isolated — creates its own disposable project control manager login, project, work order, crews and overdue work-start checkpoints without modifying the organisation checkpoint template, and deletes all owned rows in finally.
/**
 * JOB-F3 — project control manager reviews crews that missed the work-start target time.
 * With two rostered crews whose today work-start checkpoint is past due and unrecorded, the project control
 * manager opens Site reports, follows the Crews on time link, and sees both crews listed as Not started with
 * 0 of 1 days on time.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, PM_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-F3 project control manager sees overdue unstarted crews on the crews-on-time screen', async ({ page }) => {
  const svc = serviceClient('JOB-F3');
  const run = runId('f3');
  const today = orgToday();
  const pcm = await roleJobUser(svc, 'project_control_manager', runId('f3-pcm'));
  let projectId = '';
  let workOrderId = '';
  let crewAId = '';
  let crewBId = '';
  const crewAName = `${run} Crew Alpha`;
  const crewBName = `${run} Crew Bravo`;
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} site work`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;

    crewAId = need('crew A', await svc.from('crews').insert({
      org_id: ORG_ID, code: `F3A-${Date.now().toString(36).slice(-7)}`, name: crewAName, kind: 'own',
    }).select('id').single()).id;
    crewBId = need('crew B', await svc.from('crews').insert({
      org_id: ORG_ID, code: `F3B-${Date.now().toString(36).slice(-7)}`, name: crewBName, kind: 'own',
    }).select('id').single()).id;

    const pastDue = new Date(Date.now() - 3600_000).toISOString();
    for (const cid of [crewAId, crewBId]) {
      ok('roster', await svc.from('work_order_crews').insert({
        org_id: ORG_ID, work_order_id: workOrderId, crew_id: cid, valid_from: today,
      }));
      ok('checkpoint', await svc.from('site_checkpoints').insert({
        org_id: ORG_ID, work_order_id: workOrderId, crew_id: cid, work_date: today, position: 1,
        name: 'Work start', marks_work_start: true, due_at: pastDue, grace_minutes: 0, photo_required: true,
      }));
    }

    // 1. Project control manager opens Site reports and navigates to Crews on time.
    await pcm.signIn(page);
    await page.goto('/site-reports');
    const link = page.getByTestId('crews-link');
    await expect(link).toBeVisible({ timeout: 20_000 });
    await link.click();
    await expect(page).toHaveURL(/\/site-reports\/crews$/, { timeout: 15_000 });

    // 2. Goal: both overdue crews appear under Missed the target time as Not started (0 of 1 days on time).
    const section = page.getByTestId('crew-punctuality');
    await expect(section).toBeVisible({ timeout: 20_000 });
    for (const [cid, name] of [[crewAId, crewAName], [crewBId, crewBName]] as const) {
      const row = section.getByTestId(`crew-${cid}`);
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).toContainText(name);
      await expect(row).toContainText('0 of 1 days on time');
      await expect(row).toContainText('Not started');
      await expect(row).toContainText(/Target /);
    }
  } finally {
    if (workOrderId) {
      ok('checkpoints cleanup', await svc.from('site_checkpoints').delete().eq('work_order_id', workOrderId));
      ok('roster cleanup', await svc.from('work_order_crews').delete().eq('work_order_id', workOrderId));
    }
    const crewIds = [crewAId, crewBId].filter(Boolean);
    if (crewIds.length) ok('crews cleanup', await svc.from('crews').delete().in('id', crewIds));
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await pcm.cleanup();
  }
});
