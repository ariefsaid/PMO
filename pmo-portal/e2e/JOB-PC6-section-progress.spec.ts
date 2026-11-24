// @e2e-isolation: self-isolated — own project, sections, report and disposable job-role logins; cleanup removes all fixture rows.
import { test, expect } from '@playwright/test';
import { serviceClient, ORG_ID } from './support/jobJourney';
import { seedWorkOrder } from './support/crewJourney';
import { createJobRoleUser } from './support/jobRoleUser';
import { cleanupAll } from './support/jobFixtures';
import { signIn } from './helpers';

async function removePaperPhotos(db: ReturnType<typeof serviceClient>, reportId: string) {
  if (!reportId) return;
  const photos = await db.from('dsr_photos').select('file_path').eq('report_id', reportId);
  if (photos.error) throw photos.error;
  const paths = (photos.data ?? []).map(photo => photo.file_path);
  if (paths.length > 0) {
    const removed = await db.storage.from('site-report-photos').remove(paths);
    if (removed.error) throw removed.error;
  }
}

test.setTimeout(180000);
test('JOB-PC6 planner sections receive the progress recorded by a field administrator', async ({ page }) => {
  const db = serviceClient('JOB-PC6');
  const run = `Section-${crypto.randomUUID().slice(0, 8)}`;
  const wo = await seedWorkOrder(db, 'JOB-PC6', run, 'site');
  const planner = await createJobRoleUser(db, ORG_ID, 'planner');
  const recorder = await createJobRoleUser(db, ORG_ID, 'project_administrator');
  let boqId = '';
  let reportId = '';
  try {
    const boq = await db.from('boq_items').insert({ org_id: ORG_ID, project_id: wo.projectId, item_code: run, description: 'Measured work', unit: 'm', quantity: 100, rate: 5 }).select('id').single();
    if (boq.error) throw boq.error;
    boqId = boq.data.id;
    const line = await db.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.workOrderId, boq_item_id: boqId, quantity: 100 });
    if (line.error) throw line.error;
    await planner.signIn(page);
    await page.goto(`/work-orders/${wo.workOrderId}`);
    for (const code of ['A', 'B']) {
      await page.getByRole('button', { name: /add section/i }).click();
      await page.getByRole('dialog').getByRole('textbox', { name: 'Code', exact: true }).fill(code);
      await page.getByRole('dialog').getByRole('textbox', { name: 'Name', exact: true }).fill(`Front ${code}`);
      await page.getByRole('dialog').getByRole('button', { name: /save section/i }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByTestId(`wo-section-${code}`)).toContainText(`${code} · Front ${code}`);
    }
    await recorder.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: `${run} site` });
    await page.getByRole('combobox', { name: 'Work order', exact: true }).selectOption({ label: wo.title });
    await page.getByRole('button', { name: 'Start report' }).click();
    await page.getByRole('button', { name: 'Add progress' }).click();
    await page.getByLabel('Contract item').selectOption({ label: `${run} · Measured work` });
    const sectionPicker = page.getByLabel('Section', { exact: true });
    await sectionPicker.selectOption({ label: 'A · Front A' });
    const sectionAId = await sectionPicker.inputValue();
    expect(sectionAId).not.toBe('');
    await page.getByLabel(/^Quantity/).fill('12.5');
    reportId = page.url().split('/').pop()!;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'paper-form.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('dsr-photos').getByText('paper-form.png', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.reload();
    await expect(page.getByLabel('Section', { exact: true })).toHaveValue(sectionAId);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted');
    await signIn(page, 'pm@acme.test');
    await page.goto(`/site-reports/${reportId}`);
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated');
    await planner.signIn(page);
    await page.goto(`/work-orders/${wo.workOrderId}`);
    const sectionA = page.getByTestId('wo-section-A');
    const sectionB = page.getByTestId('wo-section-B');
    const remainder = page.getByTestId('wo-section-remainder');
    await expect(sectionA).toContainText('A · Front A');
    await expect(sectionA.getByText('Validated: 12.500 m', { exact: true })).toBeVisible();
    await expect(sectionB).toContainText('B · Front B');
    await expect(sectionB).not.toContainText('12.500 m');
    await expect(remainder).toBeVisible();
    await expect(remainder).not.toContainText('12.500 m');
  } finally {
    await removePaperPhotos(db, reportId);
    await cleanupAll(db, [
      ['daily_site_reports', 'project_id', [wo.projectId]], ['work_order_sections', 'work_order_id', [wo.workOrderId]],
      ['work_order_lines', 'work_order_id', [wo.workOrderId]], ['boq_items', 'id', boqId ? [boqId] : []],
      ['work_orders', 'id', [wo.workOrderId]], ['projects', 'id', [wo.projectId]],
    ]);
    await recorder.remove();
    await planner.remove();
  }
});
