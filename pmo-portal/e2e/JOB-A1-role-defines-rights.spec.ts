// @e2e-isolation: self-isolated — two disposable logins on the seed org (Administrator and Quantity Surveyor); no shared row is written and both logins are deleted in finally.
/**
 * JOB-A1 — roles we define: a person's job role decides what they can do.
 * The Administrator sees the person's job role in the user directory. The Quantity Surveyor — the role the case
 * gives a user — signs in and gets the daily report entry, and is offered no crew-time approval: the timesheet
 * review surface refuses them and Timesheets carries no approvals affordance.
 * Goal oracle: the Quantity Surveyor sees "New report" on Site reports, and cannot open the timesheet review.
 * Screen note: the app ships the job roles and assigns one per person (Administration → Users → Change job role),
 * so the directory is the Admin's role screen; there is no separate "Roles" page.
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from './helpers';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { markEveryonePresent } from './support/crewJourney';

test.setTimeout(180_000);

test('JOB-A1 an administrator assigns the Quantity Surveyor role and that role gets report entry but no crew-time approval', async ({ page }) => {
  const svc = serviceClient('JOB-A1');
  const surveyorName = runId('a1-qs');
  const admin = await roleJobUser(svc, 'administrator', runId('a1-adm'));
  const surveyor = await roleJobUser(svc, 'quantity_surveyor', surveyorName);
  // The precondition is a person with no job role yet: the Administrator gives them the Quantity Surveyor role on screen (step 1).
  ok('clear job role', await svc.from('profiles').update({ built_in_role: null }).eq('id', surveyor.id));
  // A crew week waiting for approval, so "no crew-time approval" is read against a screen that has something to approve.
  const week = await pendingCrewWeek(svc, page, runId('a1-crew'));
  try {
    // Control: a Project Manager (a crew-time approver) does see that week with its Approve, so the surveyor's empty queue below is the role's, not the screen's.
    await signIn(page, 'pm@acme.test');
    await page.goto('/crews?view=attendance');
    await expect(page.getByRole('row', { name: week.workerName }).getByRole('button', { name: 'Approve' })).toBeVisible({ timeout: 20_000 });

    // 1. Administrator opens the user directory and gives the person the Quantity Surveyor job role.
    await admin.signIn(page);
    await page.goto('/administration/users');
    await page.getByLabel('Search users').fill(surveyorName);
    const row = page.getByRole('row', { name: new RegExp(surveyorName) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Change job role' }).click();
    await page.getByRole('combobox', { name: 'Job role' }).selectOption('quantity_surveyor');
    await page.getByRole('button', { name: 'Save job role' }).click();
    await page.getByRole('button', { name: 'Change role' }).click();
    await expect(page.getByRole('row', { name: new RegExp(surveyorName) }).getByText('Quantity Surveyor')).toBeVisible({ timeout: 20_000 });

    // 2. The Quantity Surveyor signs in and sees the daily report entry.
    await surveyor.signIn(page);
    await page.goto('/site-reports');
    await expect(page.getByRole('button', { name: 'New report' }).first()).toBeVisible({ timeout: 20_000 });

    // 3. …and is not offered the crew-time approval: the review surface refuses them. (The global Approvals entry in the rail
    // follows a person's decision standing, not this role's crew-time right, so it is not asserted here.)
    await page.goto('/timesheets/review');
    await expect(page.getByText("You don't have access to timesheet review")).toBeVisible({ timeout: 20_000 });

    // ...and the crew-time approval itself: a week waits on the attendance screen, and the surveyor has no Approve for it.
    await page.goto('/crews?view=attendance');
    await expect(page.getByText("Choose a work order to record its crew's day")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('row', { name: week.workerName })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  } finally {
    await week.cleanup();
    await surveyor.cleanup();
    await admin.cleanup();
  }
});

/** A crew of one, with a week the field controller (the seed Engineer) has recorded and sent on screen, waiting for approval. */
async function pendingCrewWeek(svc: ReturnType<typeof serviceClient>, page: import('@playwright/test').Page, run: string) {
  const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
  const PM_ID = '00000000-0000-0000-0000-0000000000a2';
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86_400_000);
  const projectId = need('project', await svc.from('projects').insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id as string;
  const workOrderId = need('work order', await svc.from('work_orders').insert({ org_id: ORG_ID, project_id: projectId, title: `${run} pipe rack`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).id as string;
  const crewId = need('crew', await svc.from('crews').insert({ org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID }).select('id').single()).id as string;
  const workerName = `${run} Ana`;
  const workerId = need('worker', await svc.from('people').insert({ org_id: ORG_ID, kind: 'own', name: workerName }).select('id').single()).id as string;
  ok('placement', await svc.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: workerId, valid_from: iso(from) }));
  ok('roster', await svc.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: iso(from) }));
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
  await expect(page.getByRole('row', { name: workerName })).toBeVisible({ timeout: 20_000 });
  await markEveryonePresent(page);
  await page.getByRole('textbox', { name: 'Hours for the crew' }).fill('8');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await page.getByRole('button', { name: 'Send the week for approval' }).click();
  await expect(visibleToast(page, 'Week sent for approval')).toBeVisible({ timeout: 15_000 });
  return {
    workerName,
    async cleanup() {
      ok('attendance cleanup', await svc.from('attendance_days').delete().eq('work_order_id', workOrderId));
      ok('roster cleanup', await svc.from('work_order_crews').delete().eq('crew_id', crewId));
      ok('placement cleanup', await svc.from('crew_members').delete().eq('crew_id', crewId));
      ok('crew cleanup', await svc.from('crews').delete().eq('id', crewId));
      ok('worker cleanup', await svc.from('people').delete().eq('id', workerId));
      ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    },
  };
}
