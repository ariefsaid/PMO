// @e2e-isolation: self-isolated — creates its own disposable quantity surveyor and site supervisor logins, project, work order and contract line per run, and deletes all owned rows in finally.
/**
 * JOB-RSD — the daily-report validation default (RR-3, FR-RSD-003).
 * No Admin sets any validator role. A site supervisor files today's report with the paper-form photo, and a
 * quantity surveyor — a role that holds no Admin-granted capability — finds the report in the validation queue
 * and validates it, because the organisation's validator default admits the QS role out of the box.
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

test('JOB-RSD a quantity surveyor validates a daily report with no Admin-set validator roles', async ({ page }) => {
  const svc = serviceClient('JOB-RSD');
  const run = runId('rsd');
  const author = await roleJobUser(svc, 'site_supervisor', runId('rsd-author'));
  const qs = await roleJobUser(svc, 'quantity_surveyor', runId('rsd-qs'));
  let projectId = '';
  let workOrderId = '';
  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD',
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe run`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    const boq = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: 'R-1', description: 'Weld joints', unit: 'm', quantity: 100, rate: 5,
    }).select('id').single());
    ok('allocation', await svc.from('work_order_lines').insert({
      org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boq.id, quantity: 100,
    }));

    // The organisation names no validator roles: the setting stays at its shipped default for the whole journey.
    const setting = await svc.from('organizations').select('daily_report_validate_roles').eq('org_id', ORG_ID).single();
    if (setting.error) throw new Error('org setting: ' + setting.error.message);
    if ((setting.data.daily_report_validate_roles ?? []).length > 0) {
      throw new Error('precondition: an Admin list exists; the default-under-test would not be exercised');
    }

    // 1. The site supervisor files today's report (photo required) and submits it.
    await author.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByRole('combobox', { name: 'Work order' }).selectOption({ label: `${run} pipe run` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'R-1 · Weld joints' });
    await page.getByLabel(/^Quantity/).fill('12.5');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(visibleToast(page, 'Not sent: add a photo of the paper form first')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'paper-form.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });

    // 2. Goal: the quantity surveyor — no Admin list, no granted capability — validates from the queue.
    await qs.signIn(page);
    await page.goto('/site-reports');
    const queue = page.getByTestId('dsr-queue');
    const link = queue.getByRole('link', { name: new RegExp(`${run} pipe run`) });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
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
    await author.cleanup();
    await qs.cleanup();
  }
});
