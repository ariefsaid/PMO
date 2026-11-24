// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order and issue; cleanup removes the issue, its tasks and the project.
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from './helpers';
import { addIssueType, cleanSiteIssue } from './siteIssueFixture';
import { serviceClient } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

test.setTimeout(180_000);
const db = serviceClient('JOB-PC17');
const run = `E2E-FOLLOWUP-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };

test.beforeEach(async () => { wo = await seedWorkOrder(db, 'JOB-PC17', run, 'plant'); });
test.afterEach(async () => {
  await db.from('incident_reports').update({ task_id: null }).eq('type', `${run} issue`);
  await cleanSiteIssue(`${run} issue`);
  await db.from('tasks').delete().eq('project_id', wo.projectId);
  await db.from('work_orders').delete().eq('id', wo.workOrderId);
  await db.from('projects').delete().eq('id', wo.projectId);
});

test('JOB-PC17: an Engineer reporter assigns two follow-ups and records the root cause', async ({ page }) => {
  const profile = await db.from('profiles').select('full_name').eq('email', 'engineer@acme.test').single();
  if (profile.error) throw profile.error;
  await addIssueType(`${run} issue`);
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/incidents?project=${wo.projectId}`);
  await page.getByRole('button', { name: /file incident/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).selectOption({ label: `${run} issue` });
  await dialog.getByLabel(/what must be done/i).fill(`${run} first task`);
  await dialog.getByRole('button', { name: /^file incident$/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole('link', { name: new RegExp(`open ${run} issue`, 'i') }).click();
  for (const name of [`${run} first task`, `${run} second task`]) {
    await page.getByTestId('incident-add-task').click();
    await page.getByRole('dialog').getByLabel(/^Task/).fill(name);
    await pickComboboxOption(page.getByRole('dialog'), page, /person in charge/i, profile.data.full_name);
    await page.getByRole('dialog').getByRole('button', { name: 'Add a task' }).click();
    await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 20_000 });
  }
  const second = `${run} second task`;
  await page.getByTestId('incident-root-cause-add').click();
  await page.getByLabel('Root cause').fill('Wrong fixing spec');
  await page.getByTestId('incident-root-cause-save').click();
  await expect(page.getByTestId('incident-root-cause')).toContainText('Wrong fixing spec', { timeout: 20_000 });

  // Reporting does not transfer the issue owner's closing authority.
  await expect(page.getByTestId('incident-advance')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('link', { name: `${run} first task` })).toBeVisible();
  await expect(page.getByRole('link', { name: second })).toBeVisible();
  await expect(page.getByTestId('incident-root-cause')).toContainText('Wrong fixing spec');
  await page.goto('/my-tasks');
  await expect(page.getByRole('link', { name: `${run} first task` })).toBeVisible();
  await expect(page.getByRole('link', { name: second })).toBeVisible();
});
