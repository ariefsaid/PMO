// @e2e-isolation: self-isolated — owns its client, project, work order, purchase, inspection and report file; deletes only those rows in finally.
/**
 * JOB-BQ9 (quality lane): a third-party test requested with a cost. The Quality Inspector opens the tracker on the work order,
 * records the invitation and the execution, attaches the report and marks it reported — the tracker then shows the test done
 * with its report. Its money (committed against the purchase) is not shown to the inspector's access level: recorded as a gap in
 * docs/private/walk-1124c/lane-hes.md rather than worked around here.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { createJobRoleUser } from './support/jobRoleUser';
import { createProcurementFixture, type ProcurementFixture } from './procurement-fixture';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(180_000);

const PDF = Buffer.from('%PDF-1.4 e2e inspection report');

test('JOB-BQ9 a quality inspector records the test, attaches its report and the tracker shows it done', async ({ page }) => {
  const db = serviceClient('JOB-BQ9-QI');
  const run = runId('bq9q');
  const quality = await createJobRoleUser(db, ORG_ID, 'quality_inspector');
  const pm = await createJobRoleUser(db, ORG_ID, 'project_manager');
  let projectId = '';
  let workOrderId = '';
  let companyId = '';
  let inspectionId = '';
  let purchase: ProcurementFixture | undefined;
  try {
    const finance = need('finance profile', await db.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
    companyId = need('client', await db.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
    projectId = need('project', await db.from('projects').insert({
      org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'USD', client_id: companyId, contract_value: 100_000,
      tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 0, tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single()).id as string;
    workOrderId = crypto.randomUUID();
    ok('work order', await db.from('work_orders').insert({
      id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} order`, wo_number: `WO-${run}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }));
    // The test was requested with its cost (the purchase and its issued order, both made before the inspection runs).
    purchase = await createProcurementFixture({ status: 'Approved', title: run, projectId, requestedBy: finance.id, withSupplier: true, rate: 12_000 });
    ok('purchase order', await db.from('purchase_orders').insert({
      procurement_id: purchase.id, org_id: ORG_ID, work_order_id: workOrderId, status: 'Issued',
      po_number: `PO-${run}`, date: orgToday(), amount: 12_000, currency: 'USD',
    }));
    inspectionId = need('inspection', await db.from('third_party_inspections').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, title: `${run} weld test`, test_kind: 'Radiography',
      planned_date: orgToday(), required_for: ['billing'], status: 'purchase_raised',
      procurement_id: purchase.id, estimate: 12_000, estimate_currency: 'USD',
      created_by: finance.id, purchase_raised_at: new Date().toISOString(), purchase_raised_by: finance.id,
    }).select('id').single()).id as string;

    // 1–3. The Quality Inspector records the invitation, the execution and the report.
    await quality.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'checks');
    const card = page.getByTestId(`inspection-${inspectionId}`);
    await expect(card.getByTestId('inspection-status')).toHaveText('Purchase raised');
    await card.getByRole('button', { name: 'Record invitation' }).click();
    await expect(card.getByTestId('inspection-status')).toHaveText('Invited', { timeout: 15_000 });
    await card.getByRole('button', { name: 'Record execution' }).click();
    await expect(card.getByTestId('inspection-status')).toHaveText('Executed', { timeout: 15_000 });
    await card.getByTestId('inspection-file-input').setInputFiles({ name: 'weld-report.pdf', mimeType: 'application/pdf', buffer: PDF });
    const reportFile = card.getByRole('button', { name: 'weld-report.pdf' });
    await expect(reportFile).toBeVisible({ timeout: 20_000 });
    await card.getByLabel('Result').selectOption('pass');
    await card.getByRole('button', { name: 'Mark reported' }).click();

    // 4. The tracker shows the test done and its report.
    await expect(card.getByTestId('inspection-status')).toHaveText('Reported', { timeout: 15_000 });
    await expect(card.getByText('Pass')).toBeVisible();
    await expect(reportFile).toBeVisible();

    // The cost behind the purchase is money: a money role reads it on the same card.
    await page.context().clearCookies();
    await pm.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'checks');
    await expect(page.getByTestId(`inspection-${inspectionId}`).getByTestId('inspection-cost')).toContainText(/12[.,]000/, { timeout: 15_000 });
  } finally {
    if (inspectionId) {
      const files = await db.from('third_party_inspection_files').select('file_path').eq('inspection_id', inspectionId);
      const paths = (files.data ?? []).map((f) => f.file_path);
      await db.from('third_party_inspection_files').delete().eq('inspection_id', inspectionId);
      if (paths.length) await db.storage.from('inspection-reports').remove(paths);
      await db.from('record_changes').delete().eq('entity_id', inspectionId);
      await db.from('third_party_inspections').delete().eq('id', inspectionId);
    }
    await purchase?.cleanup();
    if (workOrderId) ok('work order', await db.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) ok('project', await db.from('projects').delete().eq('id', projectId));
    if (companyId) ok('client', await db.from('companies').delete().eq('id', companyId));
    await quality.remove();
    await pm.remove();
  }
});
