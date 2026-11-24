// @e2e-isolation: self-isolated — creates its own disposable quantity surveyor and project manager logins, project, work order and contract line per run, and deletes all owned rows in finally.
/**
 * JOB-F1 — one daily site report per work order per day with required paper-form photo and independent validation.
 * A quantity surveyor starts today's report on a work order, enters progress, sees submission refused without a
 * paper-form photo, uploads the photo, submits the report (cannot validate it), and the assigned project manager
 * validates it from the queue.
 */
import { test, expect } from '@playwright/test';
import { visibleToast } from './helpers';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('JOB-F1 quantity surveyor files a daily site report with a paper-form photo and project manager validates it', async ({ page }) => {
  const svc = serviceClient('JOB-F1');
  const run = runId('f1');
  const qs = await roleJobUser(svc, 'quantity_surveyor', runId('f1-qs'));
  const pm = await roleJobUser(svc, 'project_manager', runId('f1-pm'));
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
    const boq = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: 'W-1', description: 'Weld joints', unit: 'm', quantity: 100, rate: 5,
    }).select('id').single());
    ok('allocation', await svc.from('work_order_lines').insert({
      org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boq.id, quantity: 100,
    }));

    // 1. Quantity surveyor starts today's report and enters progress.
    await qs.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByLabel('Work order').selectOption({ label: `${run} pipe run` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'W-1 · Weld joints' });
    await page.getByLabel(/^Quantity/).fill('12.5');

    // 2. Submitting without a paper-form photo is refused and keeps the report in draft.
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(visibleToast(page, 'Not sent: add a photo of the paper form first')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'draft');

    // 3. Upload the paper-form photo, then submit; author cannot validate their own report.
    await page.getByTestId('dsr-photo-input').setInputFiles({
      name: 'paper-form.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png', { timeout: 20_000 });
    await expect(page.getByTestId('dsr-author-needs-photo')).toHaveCount(0);

    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0);

    // 4. Goal: assigned project manager finds the report in the queue and validates it.
    await pm.signIn(page);
    await page.goto('/site-reports');
    const queue = page.getByTestId('dsr-queue');
    const link = queue.getByRole('link', { name: new RegExp(`${run} pipe run`) });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png');
    await expect(page.getByTestId('dsr-progress')).toContainText('12.5');
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
    await qs.cleanup();
    await pm.cleanup();
  }
});
