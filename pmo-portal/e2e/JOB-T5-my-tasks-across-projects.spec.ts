// @e2e-isolation: self-isolated — owns two projects and one task in each (unique names), deleted in afterEach.
/** JOB-T5 — a user starting the day opens My Tasks and sees their tasks from two projects together. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient, ownProject, dropProject, profileId, uniq, ORG_ID } from './support/jobFixtures';

test.setTimeout(90_000);

const admin = serviceClient();
const projects: string[] = [];
test.afterEach(async () => { for (const p of projects.splice(0)) await dropProject(admin, p); });

test('JOB-T5 My Tasks lists the user\'s tasks from two projects', async ({ page }) => {
  const who = await profileId(admin, 'engineer@acme.test');
  const names: string[] = [];
  for (const n of [1, 2]) {
    const sfx = uniq();
    const project = await ownProject(admin, `JOB-T5 project ${n} ${sfx}`);
    projects.push(project);
    const name = `JOB-T5 task ${n} ${sfx}`;
    names.push(name);
    const { error } = await admin.from('tasks').insert({ org_id: ORG_ID, project_id: project, name, status: 'In Progress', assignee_id: who });
    if (error) throw error;
  }
  await signIn(page, 'engineer@acme.test');
  await page.getByRole('navigation', { name: /primary navigation/i }).getByRole('link', { name: /my tasks/i }).click();
  await expect(page).toHaveURL(/\/my-tasks/);
  for (const name of names) await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
});
