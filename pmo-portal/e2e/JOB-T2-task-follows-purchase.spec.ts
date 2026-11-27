// @e2e-isolation: self-isolated — owns a project, a purchase and the linked task (unique names), plus a disposable project-manager login; deleted in afterEach.
/** JOB-T2 / TC-PA-19 — a task that follows a purchase shows the purchase's new status when the purchase moves to ordered. */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, need, ok, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

const admin = serviceClient('JOB-T2');
let projectId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (projectId) {
    // The task references the purchase, so it goes first.
    ok('task cleanup', await admin.from('tasks').delete().eq('project_id', projectId));
    ok('purchase cleanup', await admin.from('procurements').delete().eq('project_id', projectId));
    await dropProject(admin, projectId);
  }
  await worker?.cleanup();
  projectId = '';
});

test('JOB-T2 a task linked to a purchase shows the purchase status change', async ({ page }) => {
  const sfx = uniq();
  worker = await roleJobUser(admin, 'project_manager', runId('t2pm'));
  projectId = await ownProject(admin, `JOB-T2 project ${sfx}`, worker.id);
  const purchaseTitle = `Cable reel ${sfx}`;
  const purchase = need('purchase', await admin.from('procurements').insert({
    org_id: ORG_ID, project_id: projectId, title: purchaseTitle, status: 'Requested',
    total_value: 1000, budget_category: 'Materials',
  }).select('id').single());
  const task = need('task', await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, name: `Follow the cable order ${sfx}`, status: 'To Do', procurement_id: purchase.id,
  }).select('id').single());

  // The linked record starts at Requested.
  await worker.signIn(page);
  await page.goto(`/projects/${projectId}/tasks?open=${task.id}`);
  const linked = page.getByRole('group', { name: 'Linked record' });
  await expect(linked).toContainText(purchaseTitle, { timeout: 20_000 });
  await expect(linked).toContainText('Requested');

  // The purchase moves on to ordered; the task's own screen follows it.
  ok('purchase to ordered', await admin.from('procurements').update({ status: 'Ordered' }).eq('id', purchase.id));
  await page.reload();
  const followed = page.getByRole('group', { name: 'Linked record' });
  await expect(followed).toContainText(purchaseTitle, { timeout: 20_000 });
  await expect(followed).toContainText('Purchase order');
  await expect(followed).not.toContainText('Requested');
});
