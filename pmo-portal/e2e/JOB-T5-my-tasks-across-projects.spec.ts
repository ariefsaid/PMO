// @e2e-isolation: self-isolated — owns two projects and one task in each (unique names), plus a disposable job-role login, all deleted in afterEach.
/** JOB-T5 / TC-PA-22 — a person with tasks in two projects opens My tasks and sees both together, as the job role itself
 *  (a disposable site supervisor, never a shared seed access-level login). */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, ok, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(90_000);

const svc = serviceClient('JOB-T5');
const projects: string[] = [];
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  for (const p of projects.splice(0)) await dropProject(svc, p);
  await worker?.cleanup();
});

test('JOB-T5 a person with tasks in two projects sees both on My tasks', async ({ page }) => {
  worker = await roleJobUser(svc, 'site_supervisor', runId('t5'));
  const names: string[] = [];
  for (const n of [1, 2]) {
    const project = await ownProject(svc, `JOB-T5 project ${n} ${uniq()}`);
    projects.push(project);
    const name = `JOB-T5 task ${n} ${uniq()}`;
    names.push(name);
    ok('task', await svc.from('tasks').insert({ org_id: ORG_ID, project_id: project, name, status: 'In Progress', assignee_id: worker.id }));
  }

  await worker.signIn(page);
  await page.getByRole('navigation', { name: /primary navigation/i }).getByRole('link', { name: /my tasks/i }).click();
  await expect(page).toHaveURL(/\/my-tasks/);
  for (const name of names) await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
});
