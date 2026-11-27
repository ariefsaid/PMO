// @e2e-isolation: self-isolated — owns a project, two tasks and a dependency, plus two disposable job-role logins; all deleted in afterEach.
/** JOB-T6 / TC-PA-23 — a project manager opens a task that waits on another and sees which task it waits on and who owns it. */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, need, ok, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

const admin = serviceClient('JOB-T6');
let projectId = '';
const people: Awaited<ReturnType<typeof roleJobUser>>[] = [];

test.afterEach(async () => {
  if (projectId) await dropProject(admin, projectId, ['task_dependencies', 'tasks']);
  for (const person of people.splice(0)) await person.cleanup();
  projectId = '';
});

test('JOB-T6 a waiting task shows the task it waits on and that task\'s owner', async ({ page }) => {
  const sfx = uniq();
  const ownerName = runId('t6owner');
  const manager = await roleJobUser(admin, 'project_manager', runId('t6pm'));
  const owner = await roleJobUser(admin, 'site_supervisor', ownerName);
  people.push(manager, owner);
  projectId = await ownProject(admin, `JOB-T6 project ${sfx}`, manager.id);

  const upstream = need('upstream task', await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, name: `Install pump ${sfx}`, status: 'In Progress', assignee_id: owner.id,
  }).select('id').single());
  const waiting = need('waiting task', await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, name: `Test pump ${sfx}`, status: 'To Do',
  }).select('id').single());
  ok('dependency', await admin.from('task_dependencies').insert({ task_id: waiting.id, depends_on_id: upstream.id }));

  await manager.signIn(page);
  await page.goto(`/projects/${projectId}/tasks?open=${waiting.id}`);
  const depends = page.getByText('Depends on').locator('..');
  await expect(depends).toContainText(`Install pump ${sfx}`, { timeout: 20_000 });
  await expect(depends).toContainText(ownerName);
});
