// @e2e-isolation: self-isolated — creates its own disposable site supervisor login, project, work order and issue; cleanup removes the issue, its task and the project.
/**
 * JOB-F17 — an issue becomes a task (#2521, #2531). The Site Supervisor of the issue's work order opens the open issue and
 * adds a task on it, in charge of the engineer.
 * Goal oracle: the issue links back to the task, and the task appears in the owner's My Tasks.
 */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from './helpers';
import { addIssueType, cleanSiteIssue } from './siteIssueFixture';
import { ENGINEER_ID, inDays } from './support/jobJourney';
import { need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const db = serviceClient('JOB-F17');
const run = `E2E-F17-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };

test('JOB-F17 the site supervisor turns an open issue into a task the owner sees in My Tasks', async ({ page }) => {
  const supervisor = await roleJobUser(db, 'site_supervisor', runId('f17-ss'));
  try {
    wo = await seedWorkOrder(db, 'JOB-F17', run, 'plant');
    // The supervisor of the issue's work order (2380): the work order's responsible person.
    ok('responsible person', await db.from('work_orders').update({ responsible_person_id: supervisor.id }).eq('id', wo.workOrderId));
    await addIssueType(`${run} issue`);
    need('issue', await db.from('incident_reports').insert({
      org_id: process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001', project_id: wo.projectId, work_order_id: wo.workOrderId,
      incident_date: inDays(0), type: `${run} issue`, severity: 'Low', status: 'Open', action: `${run} replace the guard rail`,
      assignee_id: ENGINEER_ID,
    }).select('id').single());

    // 1. The site supervisor opens the issue from the register.
    await supervisor.signIn(page);
    await page.goto(`/incidents?project=${wo.projectId}`);
    await page.getByRole('link', { name: new RegExp(`open ${run} issue`, 'i') }).click();

    // 2. The supervisor adds a task from the issue, in charge of the engineer.
    await page.getByTestId('incident-add-task').click();
    const dialog = page.getByRole('dialog', { name: 'Add a task' });
    await dialog.getByLabel(/^Task/).fill(`${run} replace the guard rail`);
    await pickComboboxOption(dialog, page, /person in charge/i, /Tomas/);
    await dialog.getByRole('button', { name: 'Add a task' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    // 3. Goal: the issue lists its task as a link back to it...
    await expect(page.getByRole('link', { name: `${run} replace the guard rail` })).toBeVisible({ timeout: 20_000 });

    // ...and the owner (the engineer) finds it in My Tasks.
    await signIn(page, 'engineer@acme.test');
    await page.goto('/my-tasks');
    await expect(page.getByRole('link', { name: `${run} replace the guard rail` })).toBeVisible({ timeout: 20_000 });
  } finally {
    await db.from('incident_reports').update({ task_id: null }).eq('type', `${run} issue`);
    await cleanSiteIssue(`${run} issue`);
    if (wo.projectId) {
      await db.from('tasks').delete().eq('project_id', wo.projectId);
      await db.from('work_orders').delete().eq('id', wo.workOrderId);
      await db.from('projects').delete().eq('id', wo.projectId);
    }
    await supervisor.cleanup();
  }
});
