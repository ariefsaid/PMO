// @e2e-isolation: self-isolated — owns a project and one task, plus three disposable job-role logins (manager, A, B); all deleted in afterEach.
/** JOB-T8 / TC-PA-25 — a project manager reassigns a task from A to B: it leaves A's My tasks and appears in B's.
 *  All three people are disposable job-role users, not shared access-level seed logins. */
import { test, expect } from '@playwright/test';
import { pickComboboxOption } from './helpers';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, ok, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

const admin = serviceClient('JOB-T8');
let projectId = '';
const people: Awaited<ReturnType<typeof roleJobUser>>[] = [];

test.afterEach(async () => {
  if (projectId) await dropProject(admin, projectId);
  for (const person of people.splice(0)) await person.cleanup();
  projectId = '';
});

test('JOB-T8 reassigning a task moves it from one My tasks to the other', async ({ page }) => {
  const sfx = uniq();
  const name = `JOB-T8 task ${sfx}`;
  const managerName = runId('t8m');
  const toName = runId('t8b');
  const manager = await roleJobUser(admin, 'project_manager', managerName);
  const from = await roleJobUser(admin, 'site_supervisor', runId('t8a'));
  const to = await roleJobUser(admin, 'site_supervisor', toName);
  people.push(manager, from, to);
  projectId = await ownProject(admin, `JOB-T8 project ${sfx}`);
  ok('task', await admin.from('tasks').insert({ org_id: ORG_ID, project_id: projectId, name, status: 'In Progress', assignee_id: from.id }));

  // A starts the day with the task.
  await from.signIn(page);
  await page.goto('/my-tasks');
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  // The manager reassigns it to B.
  await manager.signIn(page);
  await page.goto(`/projects/${projectId}/tasks`);
  const row = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${name}`, exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: /^edit$/i }).click();
  const dialog = page.getByRole('dialog');
  await pickComboboxOption(dialog, page, /assignee/i, new RegExp(toName));
  await dialog.getByRole('button', { name: /save task/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // It left A's My tasks.
  await from.signIn(page);
  await page.goto('/my-tasks');
  await expect(page.getByTestId('my-tasks-open-count')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);

  // And it is in B's.
  await to.signIn(page);
  await page.goto('/my-tasks');
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
});
