// @e2e-isolation: self-isolated — creates a unique project, subcontract purchase, work order and crew each run; the issued PO lines, frozen certificate and bill are append-only, so the fixtures stay (the run's names carry a unique suffix).
/**
 * AC-SPC-020 — goal: a month of validated subcontractor work becomes a payable vendor bill on the right work order without retyping a
 * quantity. Finance sets the agreed rate, the project manager prepares and submits the certificate, a DIFFERENT person (Finance) approves it
 * and creates the bill; the preparer is never offered Approve.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(180_000);

async function confirm(page: Page, label: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: label, exact: true }).click();
}

test('AC-SPC-020 validated vendor-crew work is certified at the agreed rate, approved by another person and billed on the work order', async ({ page }, testInfo) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-SPC-020 requires the local fixture service client');
  const url = requireMatchingLocalSupabaseUrls(undefined, undefined);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const suffix = `SPC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const id = () => crypto.randomUUID();
  const projectId = id(); const purchaseId = id(); const poId = id(); const workOrderId = id(); const docId = id();
  const woLineId = id(); const crewId = id(); const acceptanceId = id();
  const reportIds = [id(), id()];

  const [pm, finance, exec] = await Promise.all([
    admin.from('profiles').select('id, org_id').eq('email', 'pm@acme.test').single().throwOnError(),
    admin.from('profiles').select('id').eq('email', 'finance@acme.test').single().throwOnError(),
    admin.from('profiles').select('id').eq('email', 'exec@acme.test').single().throwOnError(),
  ]);
  const orgId = pm.data.org_id as string;
  const vendor = await admin.from('companies').insert({ org_id: orgId, name: `Certificate vendor ${suffix}`, type: 'Vendor' }).select('id').single().throwOnError();
  const vendorId = vendor.data.id as string;
  await admin.from('projects').insert({ id: projectId, org_id: orgId, name: `Certificate project ${suffix}`, status: 'Ongoing Project', currency: 'IDR', project_manager_id: pm.data.id }).throwOnError();
  const item = await admin.from('boq_items').insert({ org_id: orgId, project_id: projectId, item_code: `A-${suffix}`, description: `Concrete ${suffix}`, unit: 'm3', quantity: 100, rate: 12 }).select('id').single().throwOnError();
  const boqItemId = item.data.id as string;
  await admin.from('work_orders').insert({ id: workOrderId, org_id: orgId, project_id: projectId, title: `Certificate WO ${suffix}`, order_value: 0, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 0 }).throwOnError();
  await admin.from('work_order_lines').insert({ id: woLineId, org_id: orgId, work_order_id: workOrderId, boq_item_id: boqItemId, quantity: 100 }).throwOnError();
  await admin.from('crews').insert({ id: crewId, org_id: orgId, code: `C-${suffix.slice(-8)}`, name: `Vendor crew ${suffix}`, kind: 'vendor', vendor_company_id: vendorId }).throwOnError();
  await admin.from('procurements').insert({
    id: purchaseId, org_id: orgId, project_id: projectId, title: `Subcontract ${suffix}`, status: 'Ordered', currency: 'IDR', total_value: 1200, approved_total_value: 1200,
    requested_by_id: pm.data.id, approved_by_id: exec.data.id, amount_approved_by_id: exec.data.id, budget_category: 'Subcontractors', vendor_id: vendorId, is_subcontract: true,
  }).throwOnError();
  await admin.from('purchase_orders').insert({ id: poId, org_id: orgId, procurement_id: purchaseId, status: 'Issued', amount: 1200, currency: 'IDR', po_number: `PO-${suffix}`, work_order_id: workOrderId }).throwOnError();
  await admin.from('purchase_order_lines').insert({ org_id: orgId, po_id: poId, revision: 1, boq_item_id: boqItemId, quantity: 100, rate: 12, unit: 'm3' }).throwOnError();
  await admin.from('purchase_order_revisions').insert({ org_id: orgId, po_id: poId, procurement_id: purchaseId, revision: 1, status: 'Issued', total: 1200, issued_by: pm.data.id, issue_basis: 'standard' }).throwOnError();
  await admin.from('project_documents').insert({ id: docId, org_id: orgId, project_id: projectId, category: 'Acceptance', title: `Signed acceptance ${suffix}`, status: 'Issued', file_path: `${orgId}/${projectId}/${docId}/ba.pdf` }).throwOnError();
  await admin.from('subcontract_acceptances').insert({ id: acceptanceId, org_id: orgId, project_id: projectId, po_id: poId, acceptance_date: '2026-03-31', status: 'Confirmed',
    prepared_by: pm.data.id, confirmed_by: finance.data.id, confirmed_at: new Date().toISOString(), confirm_basis: 'standard', document_id: docId }).throwOnError();
  await admin.from('subcontract_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: boqItemId, quantity: 40 }).throwOnError();
  // Two validated daily reports of the vendor crew (15 + 25 = 40 m3) in March.
  for (const [i, [date, qty]] of ([['2026-03-03', 15], ['2026-03-09', 25]] as Array<[string, number]>).entries()) {
    await admin.from('daily_site_reports').insert({ id: reportIds[i], org_id: orgId, project_id: projectId, work_order_id: workOrderId, work_date: date, status: 'validated',
      author_id: pm.data.id, submitted_at: new Date().toISOString(), validated_by: finance.data.id, validated_at: new Date().toISOString() }).throwOnError();
    await admin.from('dsr_progress_lines').insert({ org_id: orgId, report_id: reportIds[i], position: 1, work_order_line_id: woLineId, quantity: qty, unit: 'm3', crew_id: crewId }).throwOnError();
  }

  // Finance sets the agreed rate (10.00, below the PO's 12.00) from March.
  await signIn(page, 'finance@acme.test');
  await page.goto('/subcontract-certificates?view=rates');
  await page.getByRole('button', { name: 'Set a rate' }).first().click();
  const rateDialog = page.getByRole('dialog', { name: 'Set a rate' });
  await rateDialog.getByLabel('Subcontract purchase order').selectOption({ value: poId });
  await expect(rateDialog.getByLabel('Contract item')).toContainText(`A-${suffix}`, { timeout: 15_000 });
  await rateDialog.getByLabel('Contract item').selectOption({ value: boqItemId });
  await rateDialog.getByLabel(/^Rate/).fill('10');
  await rateDialog.getByLabel('From month').fill('2026-03');
  await rateDialog.getByRole('button', { name: 'Save rate' }).click();
  await expect(rateDialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('IDR 10.00 / m3').first()).toBeVisible();

  // The project manager prepares the certificate for March and submits it; she is never offered Approve.
  await signIn(page, 'pm@acme.test');
  await page.goto('/subcontract-certificates');
  await page.getByRole('button', { name: 'New certificate' }).first().click();
  const newDialog = page.getByRole('dialog', { name: 'New certificate' });
  await newDialog.getByLabel('Subcontract purchase order').selectOption({ value: poId });
  await newDialog.getByLabel('Month').fill('2026-03');
  await newDialog.getByRole('button', { name: 'Prepare certificate' }).click();
  await expect(page).toHaveURL(/\/subcontract-certificates\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const certificateUrl = page.url();
  await expect(page.getByTestId('spc-gross')).toHaveText('IDR 400.00', { timeout: 15_000 });
  await expect(page.getByTestId('spc-net')).toHaveText('IDR 400.00');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByTestId('spc-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await testInfo.attach('submitted', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  // A different person (Finance) approves and bills.
  await signIn(page, 'finance@acme.test');
  await page.goto(certificateUrl);
  await expect(page.getByTestId('spc-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('spc-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Create bill' }).click();
  await confirm(page, 'Create bill');
  await expect(page.getByTestId('spc-status')).toHaveAttribute('data-status', 'billed', { timeout: 20_000 });
  await testInfo.attach('billed', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  // The payable bill exists on the work order, built from the certificate's lines with nothing retyped.
  const bills = await admin.from('procurement_invoices').select('id, amount, work_order_id, deduction_amount, certificate_id').eq('procurement_id', purchaseId).throwOnError();
  expect(bills.data).toHaveLength(1);
  expect(Number(bills.data![0].amount)).toBe(400);
  expect(bills.data![0].work_order_id).toBe(workOrderId);
  expect(Number(bills.data![0].deduction_amount)).toBe(0);
  const lines = await admin.from('procurement_invoice_lines').select('quantity, rate').eq('invoice_id', bills.data![0].id).throwOnError();
  expect(lines.data!.map((l) => [Number(l.quantity), Number(l.rate)])).toEqual([[40, 10]]);
});
