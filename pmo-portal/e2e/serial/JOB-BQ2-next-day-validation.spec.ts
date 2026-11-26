// @e2e-isolation: serial — the Admin names the project control manager as a report validator, an org-wide setting; the spec reads it, sets it and restores it in finally.
/**
 * JOB-BQ2 (billing lane): next-day validation opens the daily revenue. A quantity surveyor sends yesterday's report with its
 * paper-form photo; it waits in "To validate" at zero validated revenue; the project control manager — a different person —
 * validates it, and only then does the work order's validated revenue carry it (12.5 m × 5 = 62.50).
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { createJobRoleUser } from '../support/jobRoleUser'
import { userClient } from '../support/stockFixture';
import { ADMIN_SEED_EMAIL } from '../support/transferJourney';;

test.setTimeout(180_000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('JOB-BQ2 a submitted report waits at zero validated revenue until another person validates it', async ({ page }) => {
  const svc = serviceClient('JOB-BQ2');
  const run = runId('bq2');
  const qs = await createJobRoleUser(svc, ORG_ID, 'quantity_surveyor');
  const pcm = await createJobRoleUser(svc, ORG_ID, 'project_control_manager');
  const admin = await userClient(ADMIN_SEED_EMAIL);
  const before = need('org settings', await svc.from('organizations').select('built_in_roles_enabled, daily_report_validate_roles').eq('id', ORG_ID).single());
  let projectId = '';
  let workOrderId = '';
  try {
    // As an Admin would set it up: built-in roles on, and the project control manager named as a validator. The PCM does not manage the project.
    if (!before.built_in_roles_enabled) ok('Admin enables built-in roles', await admin.rpc('set_built_in_roles_enabled', { p_enabled: true }));
    ok('Admin names the validator role', await admin.rpc('set_daily_report_validate_roles', { p_roles: [...new Set([...(before.daily_report_validate_roles ?? []), 'project_control_manager'])] }));
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD',
    }).select('id').single()).id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} grader`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id;
    const boq = need('contract item', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: 'G-1', description: 'Grade the access road', unit: 'm', quantity: 100, rate: 5,
    }).select('id').single());
    ok('allocation', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boq.id, quantity: 100 }));

    // 1. The quantity surveyor files the report with its paper-form photo.
    await qs.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByRole('combobox', { name: 'Work order', exact: true }).selectOption({ label: `${run} grader` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const reportUrl = page.url();
    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'G-1 · Grade the access road' });
    await page.getByLabel(/^Quantity/).fill('12.5');
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'paper-form.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0); // never the author

    // 2. It waits for validation: the work order has no validated revenue yet.
    await page.context().clearCookies();
    await pcm.signIn(page);
    await page.goto('/site-reports');
    const queue = page.getByTestId('dsr-queue');
    const link = queue.getByRole('link', { name: new RegExp(`${run} grader`) });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted');
    const validatedToDate = page.getByText('Validated to date', { exact: true }).locator('xpath=following-sibling::div');
    await expect(validatedToDate).toContainText(/\$0\.00/);

    // 3–4. The second person validates it; only now does the work order carry the day's revenue.
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 15_000 });
    await expect(validatedToDate).toContainText(/62[.,]50/);
    await page.goto(reportUrl);
    await expect(page.getByTestId('dsr-total')).toHaveText(/62[.,]50/);
  } finally {
    ok('restore validator roles', await admin.rpc('set_daily_report_validate_roles', { p_roles: before.daily_report_validate_roles ?? [] }));
    if (!before.built_in_roles_enabled) ok('restore built-in roles', await admin.rpc('set_built_in_roles_enabled', { p_enabled: false }));
    if (projectId) {
      ok('reports cleanup', await svc.from('daily_site_reports').delete().eq('project_id', projectId));
      if (workOrderId) ok('allocations cleanup', await svc.from('work_order_lines').delete().eq('work_order_id', workOrderId));
      ok('contract items cleanup', await svc.from('boq_items').delete().eq('project_id', projectId));
      ok('work orders cleanup', await svc.from('work_orders').delete().eq('project_id', projectId));
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    }
    await qs.remove();
    await pcm.remove();
  }
});
