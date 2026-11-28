// @e2e-isolation: self-isolated — owns its role user, project, work order, tasks and dependencies.
import { test, expect } from '@playwright/test';
import { need, ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test('AC-RR-006 planner links tasks to an order and adds a dependency', async ({ page }) => {
  const db = serviceClient('JOB-RR-planner');
  const run = runId('rr-planner');
  const planner = await roleJobUser(db, 'planner', run);
  let project = ''; let order = '';
  try {
    project = need('project', await db.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id;
    order = need('order', await db.from('work_orders').insert({ org_id: ORG_ID, project_id: project, title: `${run} order`, status: 'Draft', order_value: 0, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).id;
    await planner.signIn(page);
    await page.goto(`/projects/${project}/tasks`);
    for (const suffix of ['first', 'second']) {
      await page.getByRole('button', { name: /new task/i }).first().click();
      const dialog = page.getByRole('dialog', { name: /new task/i });
      await dialog.getByLabel(/task name/i).fill(`${run} ${suffix}`);
      await dialog.getByRole('combobox', { name: /work order/i }).click();
      await page.getByRole('option', { name: `${run} order` }).click();
      await dialog.getByRole('button', { name: /create task/i }).click();
      await expect(dialog).toBeHidden();
    }
    const row = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${run} second` }) });
    await row.hover();
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: /^edit$/i }).click();
    const edit = page.getByRole('dialog', { name: /edit task/i });
    await edit.getByRole('combobox', { name: /add a dependency/i }).click();
    await page.getByRole('option', { name: `${run} first` }).click();
    await edit.getByRole('button', { name: /save task/i }).click();
    await expect(edit).toBeHidden();
    await page.getByRole('button', { name: `Open task ${run} second` }).click();
    await expect(page.getByText('Depends on').locator('..')).toContainText(`${run} first`);
  } finally {
    if (project) ok('tasks cleanup', await db.from('tasks').delete().eq('project_id', project));
    if (order) ok('order cleanup', await db.from('work_orders').delete().eq('id', order));
    if (project) ok('project cleanup', await db.from('projects').delete().eq('id', project));
    await planner.cleanup();
  }
});
