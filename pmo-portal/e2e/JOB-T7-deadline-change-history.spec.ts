// @e2e-isolation: self-isolated — owns a project and one task (unique name), plus a disposable project-manager login; deleted in afterEach.
/** JOB-T7 / TC-PA-24 — a project manager changes a task's deadline, then opens its history and sees the old and new
 *  dates together with who changed them. */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, need, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

const admin = serviceClient('JOB-T7');
let projectId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (projectId) await dropProject(admin, projectId);
  await worker?.cleanup();
  projectId = '';
});

test('JOB-T7 a changed deadline shows its old and new date and who changed it in the task history', async ({ page }) => {
  const sfx = uniq();
  const managerName = runId('t7pm');
  worker = await roleJobUser(admin, 'project_manager', managerName);
  projectId = await ownProject(admin, `JOB-T7 project ${sfx}`);
  const task = need('task', await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, name: `Pour slab ${sfx}`, status: 'To Do', end_date: '2030-01-10',
  }).select('id').single());

  await worker.signIn(page);
  await page.goto(`/projects/${projectId}/tasks?open=${task.id}`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /edit task/i });
  await dialog.getByLabel(/due date/i).fill('2030-01-15');
  await dialog.getByRole('button', { name: /save task/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // Read the task's own history fresh (the open drawer's history query is not invalidated by the edit).
  await page.reload();
  const event = page.getByTestId('history-event').filter({ hasText: 'Task updated' }).first();
  await expect(event).toContainText(managerName, { timeout: 20_000 });
  await event.getByRole('button', { name: /view details/i }).click();
  const details = event.locator('ul');
  await expect(details).toContainText('End date');
  await expect(details).toContainText('10 Jan 2030');
  await expect(details).toContainText('15 Jan 2030');
});
