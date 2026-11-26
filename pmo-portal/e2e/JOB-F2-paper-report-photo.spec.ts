// @e2e-isolation: self-isolated — creates its own disposable project administrator and project manager logins, project, work order and contract line per run, and deletes all owned rows in finally.
/**
 * JOB-F2 — paper stays, the office types it in. A project administrator keys in the crew's paper daily report: it cannot be sent
 * without a photo of the paper form, the saved report shows that photo with the administrator as its author, and the assigned
 * project manager validates it.
 * Goal oracle: the saved report shows the photo and the entering person as author, and no report without the photo reaches the
 * validator (the app refuses to send it; the validator's Validate action is off without a paper photo).
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

test('JOB-F2 the office keys in a paper report with its photo and the project manager validates it', async ({ page }) => {
  const svc = serviceClient('JOB-F2');
  const run = runId('f2');
  const paName = runId('f2-pa');
  const admin = await roleJobUser(svc, 'project_administrator', paName);
  const pm = await roleJobUser(svc, 'project_manager', runId('f2-pm'));
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

    // 1. The project administrator opens Daily reports → New report and enters the crew's paper form.
    await admin.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByLabel('Work order').selectOption({ label: `${run} pipe run` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'W-1 · Weld joints' });
    await page.getByLabel(/^Quantity/).fill('12.5');

    // 2. Without the photo of the paper form the report is refused, and the screen says the validator cannot accept it.
    await expect(page.getByTestId('dsr-author-needs-photo')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(visibleToast(page, 'Not sent: add a photo of the paper form first')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'draft');

    // 3. Attach the photo and send it: the saved report shows the photo, and its author cannot validate it.
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'crew-paper-form.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('dsr-photos')).toContainText('crew-paper-form.png', { timeout: 20_000 });
    await expect(page.getByTestId('dsr-author-needs-photo')).toHaveCount(0);
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0);

    // Goal: the saved report names the person who keyed it in as its author.
    await page.goto('/site-reports');
    const mine = page.getByTestId('dsr-list').getByRole('row').filter({ hasText: `${run} pipe run` });
    await expect(mine).toContainText(paName, { timeout: 20_000 });

    // 4. The assigned project manager sees the paper photo on the report and validates it.
    await pm.signIn(page);
    await page.goto('/site-reports');
    const queue = page.getByTestId('dsr-queue');
    const link = queue.getByRole('link', { name: new RegExp(`${run} pipe run`) });
    await expect(link).toBeVisible({ timeout: 20_000 });
    // The validator's queue names the entering person as the report's author.
    await expect(queue.getByRole('listitem').filter({ hasText: `${run} pipe run` })).toContainText(paName);
    await link.click();
    await expect(page.getByTestId('dsr-photos')).toContainText('crew-paper-form.png');
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
    await admin.cleanup();
    await pm.cleanup();
  }
});
