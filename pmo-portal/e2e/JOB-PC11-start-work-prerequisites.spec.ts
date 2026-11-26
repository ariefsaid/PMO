// @e2e-isolation: self-isolated — owns its engineer login, project, work order, three proof-required prerequisite tasks and the proof
// object; every row it created is removed in afterEach.
// JOB-PC11 (project control): start-work prerequisites. The engineer opens the work order's prerequisite tasks; the first refuses to
// close without proof, and closes once a photo is attached.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('JOB-PC11 an engineer cannot close a start-work prerequisite without proof, and closes it with a photo attached', async ({ page }) => {
  const svc = serviceClient('JOB-PC11');
  const run = runId('JOBPC11');
  const engineer = await roleJobUser(svc, 'engineer', run);

  let projectId = '';
  let woId = '';
  const taskIds: string[] = [];

  try {
    const fx = await projectWithWorkOrders(svc, run, ['Piling']);
    projectId = fx.projectId;
    woId = fx.workOrders[0].id;
    const wo = fx.workOrders[0];

    // A manager links three prerequisite tasks to the work order and requires proof before each closes.
    const tasks = need('tasks', await svc.from('tasks').insert([
      { org_id: ORG_ID, project_id: projectId, work_order_id: woId, name: `${run} scaffold handover`, status: 'To Do', assignee_id: engineer.id, proof_required: true },
      { org_id: ORG_ID, project_id: projectId, work_order_id: woId, name: `${run} permit approval`, status: 'To Do', assignee_id: engineer.id, proof_required: true },
      { org_id: ORG_ID, project_id: projectId, work_order_id: woId, name: `${run} area clearance`, status: 'To Do', assignee_id: engineer.id, proof_required: true },
    ]).select('id, name'));
    taskIds.push(...tasks.map((t: { id: string }) => t.id));
    const first = tasks[0] as { id: string; name: string };

    // The engineer opens the work order and follows its prerequisite tasks.
    await engineer.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    await openWorkOrderArea(page, 'issues');
    const openTasks = page.getByTestId('wo-open-tasks');
    await expect(openTasks).toBeVisible({ timeout: 30_000 });
    await expect(openTasks).toContainText(`${run} scaffold handover`);
    await expect(openTasks).toContainText(`${run} permit approval`);
    await expect(openTasks).toContainText(`${run} area clearance`);
    await openTasks.getByRole('link', { name: `${run} scaffold handover` }).click();

    // Closing it without proof is refused, with the reason.
    const done = page.getByRole('button', { name: /mark done/i });
    await expect(done).toBeDisabled({ timeout: 30_000 });
    await expect(page.getByText(/cannot be Done without proof/i)).toBeVisible();

    // With the proof attached it closes.
    await page.getByTestId('proof-photo-input').setInputFiles({ name: `${run}-handover.png`, mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText(`${run}-handover.png`)).toBeVisible({ timeout: 20_000 });
    await expect(done).toBeEnabled();
    await done.click();
    await expect.poll(async () => (await svc.from('tasks').select('status').eq('id', first.id).single()).data?.status, { timeout: 20_000 }).toBe('Done');

    // The work order now lists the two prerequisites still open.
    await page.goto(`/work-orders/${woId}`);
    await openWorkOrderArea(page, 'issues');
    await expect(page.getByTestId('wo-open-tasks')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wo-open-tasks')).not.toContainText('scaffold handover');
    await expect(page.getByTestId('wo-open-tasks')).toContainText(`${run} permit approval`);
    expect(wo.number).toContain('WO-');
  } finally {
    const proofs = await svc.from('task_proofs').select('file_path').in('task_id', taskIds.length ? taskIds : ['00000000-0000-0000-0000-000000000000']);
    const paths = (proofs.data ?? []).map((p) => p.file_path as string);
    if (paths.length) await svc.storage.from('task-proofs').remove(paths);
    await cleanupAll(svc, [
      ['task_proofs', 'task_id', taskIds],
      ['record_changes', 'entity_id', taskIds],
      ['tasks', 'id', taskIds],
    ]);
    await cleanupAll(svc, [
      ['work_orders', 'id', woId ? [woId] : []],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    ok('login cleanup', await svc.from('profiles').delete().eq('id', engineer.id));
    await engineer.cleanup();
  }
});
