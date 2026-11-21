// @e2e-isolation: self-isolated — owns a project and one task (unique name), deleted in afterEach.
/** JOB-T8 — a project manager reassigns a task from one person to another; it leaves the first person's My Tasks and appears in the second's. */
import { test, expect } from '@playwright/test';
import { signIn, pickComboboxOption } from './helpers';
import { serviceClient, ownProject, dropProject, profileId, uniq, ORG_ID } from './support/jobFixtures';

test.setTimeout(150_000);

const admin = serviceClient('JOB-T8');
let projectId = '';
test.afterEach(async () => { if (projectId) await dropProject(admin, projectId); projectId = ''; });

test('JOB-T8 reassigning a task moves it from one My Tasks to the other', async ({ page }) => {
  const sfx = uniq();
  const name = `JOB-T8 task ${sfx}`;
  projectId = await ownProject(admin, `JOB-T8 project ${sfx}`);
  const from = await profileId(admin, 'engineer@acme.test');
  const { error } = await admin.from('tasks').insert({ org_id: ORG_ID, project_id: projectId, name, status: 'In Progress', assignee_id: from });
  if (error) throw error;

  await signIn(page, 'engineer@acme.test');
  await page.goto('/my-tasks');
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${projectId}/tasks`);
  const row = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${name}`, exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: /^edit$/i }).click();
  const dialog = page.getByRole('dialog');
  await pickComboboxOption(dialog, page, /assignee/i, /Grace TSApprove/);
  await dialog.getByRole('button', { name: /save task/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await signIn(page, 'engineer@acme.test');
  await page.goto('/my-tasks');
  await expect(page.getByTestId('my-tasks-open-count')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);

  await signIn(page, 'ts-approve-eng@acme.test');
  await page.goto('/my-tasks');
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
});
