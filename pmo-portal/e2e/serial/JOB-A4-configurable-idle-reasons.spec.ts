// @e2e-isolation: serial — adds a run-scoped entry to the organisation-wide site-report idle reasons list and deletes the report and entry in finally.
// JOB-A4 (administration): configurable lists and steps. An administrator adds a new idle reason on Administration > Projects;
// a project administrator uses that new reason on a daily site report and submits it; the project manager validates it and the new reason persists.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(180_000);

test('JOB-A4 administrator adds a new idle reason, project administrator uses it on a daily site report, and it persists after validation', async ({ page }) => {
  const svc = serviceClient('JOB-A4');
  const run = runId('JOBA4');
  const adminUser = await roleJobUser(svc, 'administrator', `${run}-adm`);
  const fieldAdmin = await roleJobUser(svc, 'project_administrator', `${run}-fa`);
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);

  const reasonLabel = `Permit clearance wait ${run}`;
  let projectId = '';
  let woId = '';
  let boqId = '';
  let reportId = '';

  try {
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID,
      name: `${run} project`,
      status: 'Ongoing Project',
      currency: 'USD',
      project_manager_id: pm.id,
    }).select('id').single()).id as string;

    woId = crypto.randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId,
      org_id: ORG_ID,
      project_id: projectId,
      title: `${run} work scope`,
      status: 'Issued',
      wo_number: `WO-${run}`,
      issued_at: new Date().toISOString(),
      order_value: 20_000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
      currency: 'USD',
    }));

    boqId = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID,
      project_id: projectId,
      item_code: 'CFG-1',
      description: 'Configurable list check',
      unit: 'm',
      quantity: 50,
      rate: 20,
    }).select('id').single()).id as string;

    ok('work order line', await svc.from('work_order_lines').insert({
      org_id: ORG_ID,
      work_order_id: woId,
      boq_item_id: boqId,
      quantity: 50,
    }));

    // 1. Administrator adds a new idle reason in Administration > Projects > Site report lists.
    await adminUser.signIn(page);
    await page.goto('/administration/projects');
    const lists = page.locator('#site-report-lists');
    await expect(lists).toBeVisible({ timeout: 30_000 });
    const idleForm = lists.locator('form').filter({ has: page.getByLabel('New idle reasons entry') });
    await idleForm.getByLabel('New idle reasons entry').fill(reasonLabel);
    await idleForm.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(lists.getByText(reasonLabel, { exact: true })).toBeVisible({ timeout: 20_000 });

    // 2. Project administrator creates a daily site report, selects the new idle reason, and submits it.
    await fieldAdmin.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption(projectId);
    await page.getByLabel('Work order').selectOption(woId);
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    reportId = page.url().split('/').pop()!;

    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: 'CFG-1 · Configurable list check' });
    await page.getByLabel(/^Quantity/).fill('5');
    await page.getByRole('button', { name: 'Add idle time' }).click();
    await page.getByLabel('Idle minutes').fill('15');
    await page.getByLabel('Reason', { exact: true }).selectOption({ label: reasonLabel });

    ok('paper form photo', await svc.from('dsr_photos').insert({
      org_id: ORG_ID,
      report_id: reportId,
      kind: 'paper_form',
      file_path: `${ORG_ID}/${reportId}/00000000-0000-4000-8000-0000000000a4/form.jpg`,
    }));
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByTestId('dsr-author-needs-photo')).toHaveCount(0, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 20_000 });

    // 3. Project manager validates the report and confirms the new idle reason persists.
    await pm.signIn(page);
    await page.goto(`/site-reports/${reportId}`);
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 20_000 });
    await expect(page.getByLabel('Idle minutes')).toHaveValue('15');
    await expect(page.getByLabel('Reason', { exact: true }).locator('option:checked')).toHaveText(reasonLabel);
  } finally {
    await cleanupAll(svc, [
      ['daily_site_reports', 'id', reportId ? [reportId] : []],
      ['work_order_lines', 'work_order_id', woId ? [woId] : []],
      ['boq_items', 'id', boqId ? [boqId] : []],
      ['work_orders', 'id', woId ? [woId] : []],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    await svc.from('dsr_idle_reasons').delete().eq('org_id', ORG_ID).eq('label', reasonLabel);
    await pm.cleanup();
    await fieldAdmin.cleanup();
    await adminUser.cleanup();
  }
});
