// @e2e-isolation: self-isolated — owns its client, project, work order, contract line and daily report; deletes them in finally.
/**
 * JOB-BQ1 (billing lane): field progress becomes contract items, and daily revenue is quantity × rate.
 * A quantity surveyor starts the day's report, maps the work done onto a contract item with a quantity and sends it;
 * the report carries that line, and the day's revenue for it is quantity × rate (read here by the project's manager,
 * because the money figure is not shown to the quantity surveyor — reported as a gap in docs/private/walk-1124c/lane-hes.md).
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';

test.setTimeout(180_000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('JOB-BQ1 a quantity surveyor maps field progress to a contract item and the day revenue is quantity × rate', async ({ page }) => {
  const svc = serviceClient('JOB-BQ1');
  const run = runId('bq1');
  const qs = await createJobRoleUser(svc, ORG_ID, 'quantity_surveyor');
  const pm = await createJobRoleUser(svc, ORG_ID, 'project_manager');
  let projectId = '';
  let workOrderId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: pm.id,
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe run`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    const boq = need('contract item', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: 'W-1', description: 'Weld joints', unit: 'm', quantity: 100, rate: 5,
    }).select('id').single());
    ok('allocation', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boq.id, quantity: 100 }));

    // 1–3. The quantity surveyor opens a report for the work order and maps the work to the contract item.
    await qs.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByLabel('Work order').selectOption({ label: `${run} pipe run` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const reportUrl = page.url();
    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'W-1 · Weld joints' });
    await page.getByLabel(/^Quantity/).fill('12.5');
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'paper-form.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
    await expect(page.getByTestId('dsr-progress')).toContainText('12.5');

    // 4. Daily revenue for the mapped line: 12.5 m × 5 = 62.50, shown on the same report to the project's manager.
    await page.context().clearCookies();
    await pm.signIn(page);
    await page.goto(reportUrl);
    await expect(page.getByTestId('dsr-progress')).toContainText('12.5');
    await expect(page.getByTestId('dsr-total')).toHaveText(/62[.,]50/);
    await expect(page.getByTestId('dsr-line-amount').first()).toHaveText(/62[.,]50/);
  } finally {
    if (projectId) {
      ok('reports cleanup', await svc.from('daily_site_reports').delete().eq('project_id', projectId));
      if (workOrderId) ok('allocations cleanup', await svc.from('work_order_lines').delete().eq('work_order_id', workOrderId));
      ok('contract items cleanup', await svc.from('boq_items').delete().eq('project_id', projectId));
      ok('work orders cleanup', await svc.from('work_orders').delete().eq('project_id', projectId));
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    }
    await qs.remove();
    await pm.remove();
  }
});
