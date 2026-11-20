// @e2e-isolation: self-isolated — creates its own uniquely-named project and issue; cleanup removes the issue, its task and the project.
/**
 * JOB-F17 — an issue becomes a task (#2521, #2531). A manager turns an open issue, whose person in charge is the Engineer, into a task.
 * Goal oracle: the issue links to the task, and the task appears in the owner's My Tasks.
 */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from './helpers';
import { cleanSiteIssue } from './siteIssueFixture';
import { ENGINEER_ID, serviceClient } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const db = serviceClient('JOB-F17');
const run = `E2E-F17-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };

test.beforeEach(async () => { wo = await seedWorkOrder(db, 'JOB-F17', run, 'plant'); });
test.afterEach(async () => {
  await db.from('incident_reports').update({ task_id: null }).eq('type', `${run} issue`);
  await cleanSiteIssue(`${run} issue`);
  await db.from('tasks').delete().eq('project_id', wo.projectId);
  await db.from('work_orders').delete().eq('id', wo.workOrderId);
  await db.from('projects').delete().eq('id', wo.projectId);
  void ENGINEER_ID;
});

test('JOB-F17 an open issue made into a task links back and lands in the owner\'s My Tasks', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto(`/incidents?project=${wo.projectId}`);
  await page.getByRole('button', { name: /file incident/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).fill(`${run} issue`);
  await dialog.getByLabel(/what must be done/i).fill(`${run} replace the guard rail`);
  await pickComboboxOption(dialog, page, /person in charge/i, /Tomas/);
  await dialog.getByRole('button', { name: /^file incident$/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole('button', { name: new RegExp(`open ${run} issue`, 'i') }).click();
  await page.getByTestId('incident-make-task').click();
  await expect(page.getByTestId('incident-task-linked')).toBeVisible({ timeout: 20_000 });

  await signIn(page, 'engineer@acme.test');
  await page.goto('/my-tasks');
  await expect(page.getByRole('link', { name: `${run} replace the guard rail` })).toBeVisible({ timeout: 20_000 });
});
