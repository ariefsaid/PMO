// @e2e-isolation: self-isolated — owns a project, its phase, one task group and three tasks (unique names), plus a disposable project-manager login; deleted in afterEach.
/** JOB-T9 / TC-PA-26 — a project manager opens the task groups of a phase holding three tasks if two are done:
 *  the milestone shows two of three. */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, need, ok, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

const admin = serviceClient('JOB-T9');
let projectId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (projectId) {
    await admin.from('task_groups').delete().eq('project_id', projectId);
    await admin.from('project_milestones').delete().eq('project_id', projectId);
    await dropProject(admin, projectId);
  }
  await worker?.cleanup();
  projectId = '';
});

test('JOB-T9 a phase with three tasks shows two of three when two are done', async ({ page }) => {
  const sfx = uniq();
  const groupName = `Foundation ${sfx}`;
  worker = await roleJobUser(admin, 'project_manager', runId('t9pm'));
  projectId = await ownProject(admin, `JOB-T9 project ${sfx}`);
  const phase = need('phase', await admin.from('project_milestones').insert({
    org_id: ORG_ID, project_id: projectId, name: `Structure ${sfx}`, sort_order: 1,
  }).select('id').single());
  const group = need('task group', await admin.from('task_groups').insert({
    org_id: ORG_ID, project_id: projectId, name: groupName, milestone_id: phase.id,
  }).select('id').single());
  for (const [index, status] of (['Done', 'Done', 'In Progress'] as const).entries()) {
    ok('task', await admin.from('tasks').insert({
      org_id: ORG_ID, project_id: projectId, name: `Group task ${index + 1} ${sfx}`, status,
      milestone_id: phase.id, task_group_id: group.id,
    }));
  }

  await worker.signIn(page);
  await page.goto(`/projects/${projectId}/tasks`);

  // The Task groups panel opens from the toolbar's options menu.
  await page.getByRole('button', { name: 'More task options' }).click();
  await page.getByRole('menuitem', { name: 'Task groups' }).click();

  // The group under the phase counts its done work: two of three.
  const panel = page.getByRole('region', { name: 'Task groups' });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(groupName)).toBeVisible();
  await expect(panel.getByText('2 of 3 done')).toBeVisible();

  // And the milestone's own progress reads two thirds (67%).
  await expect(page.getByRole('progressbar', { name: 'Phase progress' })).toHaveAttribute('aria-valuenow', '67');
});
