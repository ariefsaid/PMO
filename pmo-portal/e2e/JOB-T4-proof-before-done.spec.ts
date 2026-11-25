// @e2e-isolation: self-isolated — owns a project, one proof-required task and a disposable job-role assignee; deleted (with its proof object) in afterEach.
/** JOB-T4 / TC-PA-21 — a task's assignee, signed in as the job role itself (a disposable site supervisor, not a shared
 *  seed access-level login), cannot close a task that needs proof until a file is attached; with the file it closes. */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const admin = serviceClient('JOB-T4');
let projectId = '';
let taskId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (taskId) {
    const { data: proofs } = await admin.from('task_proofs').select('file_path').eq('task_id', taskId);
    const paths = (proofs ?? []).map((p) => p.file_path);
    if (paths.length) await admin.storage.from('task-proofs').remove(paths);
    await admin.from('task_proofs').delete().eq('task_id', taskId);
    await admin.from('record_changes').delete().eq('entity_id', taskId);
  }
  if (projectId) await dropProject(admin, projectId);
  await worker?.cleanup();
  taskId = ''; projectId = '';
});

test('JOB-T4 a task that needs proof closes only with the file attached', async ({ page }) => {
  const sfx = uniq();
  worker = await roleJobUser(admin, 'site_supervisor', runId('t4'));
  projectId = await ownProject(admin, `JOB-T4 project ${sfx}`);
  const { data, error } = await admin.from('tasks').insert({
    org_id: ORG_ID, project_id: projectId, name: `JOB-T4 task ${sfx}`, status: 'In Progress',
    assignee_id: worker.id, proof_required: true,
  }).select('id').single();
  if (error) throw error;
  taskId = data.id;

  await worker.signIn(page);
  await page.goto(`/projects/${projectId}/tasks?open=${taskId}`);
  const done = page.getByRole('button', { name: /mark done/i });
  await expect(done).toBeDisabled({ timeout: 20_000 });
  await expect(page.getByText(/cannot be Done without proof/i)).toBeVisible();

  await page.getByTestId('proof-photo-input').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('site.png')).toBeVisible({ timeout: 20_000 });
  await expect(done).toBeEnabled();
  await done.click();
  await expect.poll(async () => (await admin.from('tasks').select('status').eq('id', taskId).single()).data?.status, { timeout: 15_000 }).toBe('Done');
});
