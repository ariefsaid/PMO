// @e2e-isolation: self-isolated — own project, sections, report and disposable job-role logins; cleanup removes all fixture rows.
import { test, expect } from '@playwright/test';
import { serviceClient, ORG_ID } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';
import { createJobRoleUser } from './support/jobRoleUser';
import { cleanupAll } from './support/jobFixtures';
import { signIn } from './helpers';

test.setTimeout(180000);
test('JOB-PC6 planner sections receive the progress recorded by a field administrator', async ({ page }) => {
  const db = serviceClient('JOB-PC6');
  const run = `Section-${crypto.randomUUID().slice(0, 8)}`;
  const wo = await seedWorkOrder(db, 'JOB-PC6', run, 'site');
  const planner = await createJobRoleUser(db, ORG_ID, 'planner');
  const recorder = await createJobRoleUser(db, ORG_ID, 'project_administrator');
  let boqId = '';
  try {
    const boq = await db.from('boq_items').insert({ org_id: ORG_ID, project_id: wo.projectId, item_code: run, description: 'Measured work', unit: 'm', quantity: 100, rate: 5 }).select('id').single();
    if (boq.error) throw boq.error;
    boqId = boq.data.id;
    const line = await db.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.workOrderId, boq_item_id: boqId, quantity: 100 });
    if (line.error) throw line.error;
    await planner.signIn(page);
    await page.goto(`/work-orders/${wo.workOrderId}`);
    await page.getByRole('button', { name: /add section/i }).click();
    await page.getByRole('dialog').getByLabel('Code', { exact: true }).fill('A');
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Front A');
    await page.getByRole('dialog').getByRole('button', { name: /save section/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await recorder.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project', { exact: true }).selectOption({ label: `${run} site` });
    await page.getByLabel('Work order', { exact: true }).selectOption({ label: wo.title });
    await page.getByRole('button', { name: 'Start report' }).click();
    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: `${run} · Measured work` });
    await page.getByLabel('Section', { exact: true }).selectOption({ label: 'A · Front A' });
    await page.getByLabel(/^Quantity/).fill('12.5');
    const reportId = page.url().split('/').pop()!;
    const photo = await db.from('dsr_photos').insert({ org_id: ORG_ID, report_id: reportId, kind: 'paper_form', file_path: `${ORG_ID}/${reportId}/proof/form.jpg` });
    if (photo.error) throw photo.error;
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.reload();
    await expect(page.getByLabel('Section', { exact: true })).toHaveValue(/.+/);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted');
    await signIn(page, 'pm@acme.test');
    await page.goto(`/site-reports/${reportId}`);
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated');
    await planner.signIn(page);
    await page.goto(`/work-orders/${wo.workOrderId}`);
    await expect(page.getByText('Front A', { exact: true })).toBeVisible();
    await expect(page.getByText(/12.5 m/)).toBeVisible();
  } finally {
    await cleanupAll(db, [
      ['daily_site_reports', 'project_id', [wo.projectId]], ['work_order_sections', 'work_order_id', [wo.workOrderId]],
      ['work_order_lines', 'work_order_id', [wo.workOrderId]], ['boq_items', 'id', boqId ? [boqId] : []],
      ['work_orders', 'id', [wo.workOrderId]], ['projects', 'id', [wo.projectId]],
    ]);
    await recorder.remove();
    await planner.remove();
  }
});
