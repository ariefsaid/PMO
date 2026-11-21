// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order and issue; cleanup removes the issue, its tasks and the project.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { cleanSiteIssue } from './siteIssueFixture';
import { serviceClient } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';

/**
 * AC-ITR-011 (#2677): a manager adds a second task and a root cause, closes the blocker, and both tasks and the root cause remain.
 * Goal oracle: after the issue is Closed (and after a reload) every task and the root cause are still shown.
 */
test.setTimeout(180_000);
const db = serviceClient('AC-ITR-011');
const run = `E2E-ITR-${Date.now()}`;
let wo = { projectId: '', workOrderId: '', title: '' };

test.beforeEach(async () => { wo = await seedWorkOrder(db, 'AC-ITR-011', run, 'plant'); });
test.afterEach(async () => {
  await db.from('incident_reports').update({ task_id: null }).eq('type', `${run} issue`);
  await cleanSiteIssue(`${run} issue`);
  await db.from('tasks').delete().eq('project_id', wo.projectId);
  await db.from('work_orders').delete().eq('id', wo.workOrderId);
  await db.from('projects').delete().eq('id', wo.projectId);
});

test('AC-ITR-011: several tasks and a root cause survive closing the issue', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto(`/incidents?project=${wo.projectId}`);
  await page.getByRole('button', { name: /file incident/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).fill(`${run} issue`);
  await dialog.getByLabel(/what must be done/i).fill(`${run} first task`);
  await dialog.getByRole('button', { name: /^file incident$/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole('link', { name: new RegExp(`open ${run} issue`, 'i') }).click();
  await page.getByTestId('incident-make-task').click();
  await expect(page.getByRole('link', { name: `${run} first task` })).toBeVisible({ timeout: 20_000 });

  const second = `${run} second task`;
  await page.getByTestId('incident-add-task').click();
  await page.getByRole('dialog').getByLabel(/^Task/).fill(second);
  await page.getByRole('dialog').getByRole('button', { name: 'Add a task' }).click();
  await expect(page.getByRole('link', { name: second })).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('incident-root-cause-add').click();
  await page.getByLabel('Root cause').fill('Wrong fixing spec');
  await page.getByTestId('incident-root-cause-save').click();
  await expect(page.getByTestId('incident-root-cause')).toContainText('Wrong fixing spec', { timeout: 20_000 });

  // Close the blocker (a Low issue closes without a photo).
  await page.getByTestId('incident-advance').click();
  await page.getByRole('dialog').getByRole('button', { name: /start investigating/i }).click();
  await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Investigating', { timeout: 20_000 });
  await page.getByTestId('incident-advance').click();
  await page.getByRole('dialog').getByRole('button', { name: /close incident/i }).click();
  await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Closed', { timeout: 20_000 });

  await page.reload();
  await expect(page.getByRole('link', { name: `${run} first task` })).toBeVisible();
  await expect(page.getByRole('link', { name: second })).toBeVisible();
  await expect(page.getByTestId('incident-root-cause')).toContainText('Wrong fixing spec');
});
