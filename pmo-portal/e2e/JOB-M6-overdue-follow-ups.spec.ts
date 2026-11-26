// @e2e-isolation: self-isolated — owns its Project Manager login, contract and one uniquely named overdue task; deletes them in finally.
// JOB-M6 (acceptance 01-management, TC-M-06): overdue follow-ups. A task past its deadline: the Project Manager opens the
// company task list, filters it to Overdue, and the late task is there with how late it is. (The acceptance script also
// says the owner was emailed; the app's email for a late item is the overdue reminder, which somebody sends — the case's
// steps name no sender, so the journey checks the screen and the reminder's own proof is AC-RMD-024.)
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { jobRoleUser } from './support/jobRole';
import { orgDay } from './support/orgDay';

test.setTimeout(120_000);

type Actor = Awaited<ReturnType<typeof jobRoleUser>>;
let admin: SupabaseClient;
let actor: Actor | undefined;
let projectId = ''; let taskId = '';

test.afterEach(async () => {
  if (!admin) return;
  if (taskId) ok('task cleanup', await admin.from('tasks').delete().eq('id', taskId));
  if (projectId) {
    await admin.from('record_changes').delete().eq('entity_id', projectId);
    ok('project cleanup', await admin.from('projects').delete().eq('id', projectId));
  }
  await actor?.cleanup();
  projectId = ''; taskId = ''; actor = undefined;
});

test('JOB-M6 the Project Manager filters the company task list to Overdue and the late task is there', async ({ page }) => {
  admin = serviceClient('JOB-M6');
  const run = runId('JOBM6');
  actor = await jobRoleUser({ service: admin, jobRole: 'project_manager', run: run });
  projectId = (await admin.from('projects').insert({
    org_id: ORG_ID, name: `${run} contract`, status: 'Ongoing Project', currency: 'USD', contract_value: 100_000,
    tax_treatment: 'exclusive', tax_amount: 0, project_manager_id: actor.id,
  }).select('id').single()).data!.id as string;
  // The late follow-up: due five days ago, still open, owned by this Project Manager.
  taskId = (await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, name: `${run} chase the client sign-off`, status: 'In Progress',
    end_date: await orgDay(-5), assignee_id: actor.id,
  }).select('id').single()).data!.id as string;

  await actor.signIn(page);
  await page.getByRole('navigation', { name: /primary navigation/i }).getByRole('link', { name: /my tasks/i }).click();
  await expect(page).toHaveURL(/\/my-tasks/);
  // The open queue counts what is late, then the filter narrows the list to it (Tasks → filter Overdue).
  await expect(page.getByTestId('my-tasks-overdue-count')).toContainText('1', { timeout: 30_000 });
  await page.getByRole('button', { name: /^overdue$/i }).click();
  await expect(page).toHaveURL(/queue=overdue/);
  const row = page.getByRole('link', { name: new RegExp(`${run} chase the client sign-off`) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`my-task-late-status-${taskId}`)).toBeVisible();
  await expect(page.getByTestId(`my-task-late-status-${taskId}`)).toContainText(/overdue|late/i);
});
