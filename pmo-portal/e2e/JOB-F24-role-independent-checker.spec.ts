// @e2e-isolation: self-isolated — creates its own disposable site supervisor, quantity surveyor and project manager logins, project, work order and contract line per run, and deletes all owned rows in finally.
/**
 * JOB-F24 — independent checker validates a submitted daily site report.
 * A site supervisor submits a daily report with a paper-form photo and sees Withdraw but no Validate button;
 * a quantity surveyor without validation rights also sees no Validate button; the project's assigned project
 * manager (independent checker) opens the submitted report from the queue and validates it.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('JOB-F24 submitted daily report cannot be validated by author or non-validator, and is validated by the assigned project manager', async ({ page }) => {
  const svc = serviceClient('JOB-F24');
  const run = runId('f24');
  const supervisor = await roleJobUser(svc, 'site_supervisor', runId('f24-ss'));
  const qs = await roleJobUser(svc, 'quantity_surveyor', runId('f24-qs'));
  const pm = await roleJobUser(svc, 'project_manager', runId('f24-pm'));
  let projectId = '';
  let workOrderId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: pm.id,
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} trenching`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    const boq = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: 'T-1', description: 'Trenching', unit: 'm', quantity: 100, rate: 10,
    }).select('id').single());
    ok('allocation', await svc.from('work_order_lines').insert({
      org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boq.id, quantity: 100,
    }));

    // 1. Site supervisor enters and submits the daily report with a paper-form photo; cannot validate own report.
    await supervisor.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByRole('combobox', { name: 'Work order' }).selectOption({ label: `${run} trenching` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const reportUrl = new URL(page.url()).pathname;

    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'T-1 · Trenching' });
    await page.getByLabel(/^Quantity/).fill('10');
    await page.getByTestId('dsr-photo-input').setInputFiles({
      name: 'daily-form.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByTestId('dsr-photos')).toContainText('daily-form.png', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0);

    // 2. Another field role without validation authority sees the submitted report read-only with no Validate button.
    await qs.signIn(page);
    await page.goto(reportUrl);
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0);

    // 3. Goal: the independent project manager validates the report from the queue.
    await pm.signIn(page);
    await page.goto('/site-reports');
    const queue = page.getByTestId('dsr-queue');
    await expect(queue.getByRole('link', { name: new RegExp(`${run} trenching`) })).toBeVisible({ timeout: 15_000 });
    await queue.getByRole('link', { name: new RegExp(`${run} trenching`) }).click();
    await expect(page.getByRole('button', { name: 'Validate' })).toBeEnabled();
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 15_000 });
  } finally {
    if (projectId) {
      ok('reports cleanup', await svc.from('daily_site_reports').delete().eq('project_id', projectId));
      if (workOrderId) ok('allocations cleanup', await svc.from('work_order_lines').delete().eq('work_order_id', workOrderId));
      ok('boq cleanup', await svc.from('boq_items').delete().eq('project_id', projectId));
      ok('work orders cleanup', await svc.from('work_orders').delete().eq('project_id', projectId));
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    }
    await supervisor.cleanup();
    await qs.cleanup();
    await pm.cleanup();
  }
});
