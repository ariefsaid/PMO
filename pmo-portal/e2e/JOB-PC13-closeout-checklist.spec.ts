// @e2e-isolation: self-isolated — owns its project-control-manager login, project, issued work order, its close-out items and an
// approved project document; deletes only rows linked to this run in finally.
// JOB-PC13 (project control): close a work order with a checklist. The project control manager attaches the certificates and marks
// each required close-out item done; the work order refuses to close while one is open, and closes once all are done.
import { test, expect } from '@playwright/test';
import { ok, ORG_ID, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

test('JOB-PC13 a project control manager marks the close-out certificates done and the work order closes only then', async ({ page }) => {
  const svc = serviceClient('JOB-PC13');
  const run = runId('JOBPC13');
  const pcm = await roleJobUser(svc, 'project_control_manager', run);

  let projectId = '';
  let woId = '';

  try {
    const fx = await projectWithWorkOrders(svc, run, ['Piling']);
    projectId = fx.projectId;
    woId = fx.workOrders[0].id;
    const wo = fx.workOrders[0];
    const today = new Date().toISOString().slice(0, 10);

    ok('close-out items', await svc.from('work_order_closeout_items').insert([
      { org_id: ORG_ID, work_order_id: woId, project_id: projectId, position: 1, name: `${run} completion certificate`, required: true, started_on: today },
      { org_id: ORG_ID, work_order_id: woId, project_id: projectId, position: 2, name: `${run} final quantity certificate`, required: true },
    ]));
    const documentId = crypto.randomUUID();
    ok('approved document', await svc.from('project_documents').insert({
      id: documentId, org_id: ORG_ID, project_id: projectId, category: 'Acceptance', title: `${run} certificates`, status: 'Approved',
      author_id: pcm.id, file_path: `${ORG_ID}/${projectId}/${documentId}/certificates.pdf`,
    }));

    await pcm.signIn(page);
    await page.route('**/api/resource/**', (route) => route.abort());
    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByTestId('closeout-summary')).toContainText('Required items not done: 2', { timeout: 30_000 });

    // The certificate is attached before an item can be marked done.
    await page.getByRole('combobox', { name: `Document for ${run} completion certificate` }).selectOption({ label: `${run} certificates` });
    await page.getByRole('button', { name: `Attach to ${run} completion certificate` }).click();
    await page.getByRole('button', { name: `Mark ${run} completion certificate done` }).click();
    await expect(page.getByTestId('closeout-summary')).toContainText('Required items not done: 1', { timeout: 20_000 });

    // With one required item open the work order cannot close, and the refusal names the count.
    await page.goto(`/projects/${projectId}/contract`);
    await page.getByRole('button', { name: `Actions for ${wo.number}` }).click();
    await page.getByRole('menuitem', { name: 'Close order' }).click();
    await page.getByRole('button', { name: 'Close work order' }).click();
    await expect(page.getByText('this work order cannot close: 1 required close-out item(s) are not done', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // The last certificate is attached and marked done; now the work order closes and names who closed it.
    await page.goto(`/work-orders/${woId}`);
    await page.getByRole('combobox', { name: `Document for ${run} final quantity certificate` }).selectOption({ label: `${run} certificates` });
    await page.getByRole('button', { name: `Attach to ${run} final quantity certificate` }).click();
    await page.getByRole('button', { name: `Mark ${run} final quantity certificate done` }).click();
    await expect(page.getByTestId('closeout-summary')).toContainText('Every required item is done', { timeout: 20_000 });

    await page.goto(`/projects/${projectId}/contract`);
    await page.getByRole('button', { name: `Actions for ${wo.number}` }).click();
    await page.getByRole('menuitem', { name: 'Close order' }).click();
    await page.getByRole('button', { name: 'Close work order' }).click();
    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByTestId('record-header')).toContainText('Closed', { timeout: 30_000 });
    await expect(page.getByTestId('closeout-summary')).toContainText('by ', { timeout: 20_000 });
  } finally {
    await svc.from('work_order_closeout_items').delete().eq('work_order_id', woId || '00000000-0000-0000-0000-000000000000');
    await svc.from('project_documents').delete().eq('project_id', projectId || '00000000-0000-0000-0000-000000000000');
    await svc.from('work_orders').delete().eq('id', woId || '00000000-0000-0000-0000-000000000000');
    await svc.from('projects').delete().eq('id', projectId || '00000000-0000-0000-0000-000000000000');
    ok('login cleanup', await svc.from('profiles').delete().eq('id', pcm.id));
    await pcm.cleanup();
  }
});
