// @e2e-isolation: self-isolated — creates a unique project and purchase each run; issued PO lines and revisions are append-only, so it archives the fixture project after the journey.
/** AC-SCA-001 — goal: verified subcontract work cannot be billed above its issued PO quantity. */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import type { Database } from '../src/lib/supabase/database.types';

test.setTimeout(180_000);

async function confirm(page: Page, label: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: label, exact: true }).click();
}

async function capture(page: Page, testInfo: TestInfo, state: string) {
  await page.screenshot({ path: testInfo.outputPath(`subcontract-${state}.png`), fullPage: true });
}

test('AC-SCA-001 verified subcontract work is billed only after a PO variation is approved and issued', async ({ page }, testInfo) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-SCA-001 requires the local fixture service client');
  const url = requireMatchingLocalSupabaseUrls(undefined, undefined);
  const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
  const suffix = `SCA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = crypto.randomUUID();
  const purchaseId = crypto.randomUUID();
  const poId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  let vendorId: string | undefined;
  let budgetVersionId: string | undefined;
  const title = `Subcontract cap ${suffix}`;
  const documentTitle = `Signed acceptance ${suffix}`;

  try {
    const [pm, executive] = await Promise.all([
      admin.from('profiles').select('id, org_id').eq('email', 'pm@acme.test').single().throwOnError(),
      admin.from('profiles').select('id').eq('email', 'exec@acme.test').single().throwOnError(),
    ]);
    const orgId = pm.data.org_id;
    const execId = executive.data.id;

    vendorId = (await admin.from('companies').insert({ org_id: orgId, name: `Subcontract vendor ${suffix}`, type: 'Vendor' }).select('id').single().throwOnError()).data.id;
    await admin.from('projects').insert({
      id: projectId, org_id: orgId, name: `Subcontract cap project ${suffix}`, status: 'Ongoing Project', currency: 'IDR',
      project_manager_id: pm.data.id,
    }).throwOnError();
    const version = await admin.from('budget_versions').insert({ org_id: orgId, project_id: projectId, name: `SCA budget ${suffix}`, version: 1, status: 'Draft', currency: 'IDR' }).select('id').single().throwOnError();
    budgetVersionId = version.data.id;
    await admin.from('budget_line_items').insert({ org_id: orgId, budget_version_id: budgetVersionId, category: 'Subcontractors', budgeted_amount: 20_000_000 }).throwOnError();
    await admin.from('budget_versions').update({ status: 'Active' }).eq('id', budgetVersionId).throwOnError();
    await admin.from('spend_approvers').insert({ org_id: orgId, project_id: projectId, profile_id: execId }).throwOnError();

    const items = await admin.from('boq_items').insert([
      { org_id: orgId, project_id: projectId, item_code: `L1-${suffix}`, description: `Concrete placement ${suffix}`, unit: 'm3', quantity: 120, rate: 100_000 },
      { org_id: orgId, project_id: projectId, item_code: `L2-${suffix}`, description: `Formwork ${suffix}`, unit: 'm2', quantity: 20, rate: 50_000 },
    ]).select('id, item_code').throwOnError();
    const boqItemId = items.data.find((item) => item.item_code.startsWith('L1-'))!.id;
    expect(items.data).toHaveLength(2);

    await admin.from('procurements').insert({
      id: purchaseId, org_id: orgId, project_id: projectId, title, status: 'Ordered', currency: 'IDR',
      total_value: 10_000_000, approved_total_value: 10_000_000, requested_by_id: pm.data.id,
      approved_by_id: execId, amount_approved_by_id: execId, budget_category: 'Subcontractors', vendor_id: vendorId, is_subcontract: true,
    }).throwOnError();
    await admin.from('purchase_orders').insert({
      id: poId, org_id: orgId, procurement_id: purchaseId, status: 'Issued', amount: 10_000_000, currency: 'IDR', po_number: `PO-${suffix}`,
    }).throwOnError();
    await admin.from('project_documents').insert({
      id: docId, org_id: orgId, project_id: projectId, category: 'Handover', title: documentTitle, status: 'Issued',
      file_path: `${orgId}/${projectId}/${docId}/acceptance.pdf`, code: `ACC-${suffix}`,
    }).throwOnError();

    const itemCode = `L1-${suffix}`;
    await signIn(page, 'pm@acme.test');
    await page.goto(`/procurement/${purchaseId}/items`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Set BoQ lines' }).click();
    const linesDialog = page.getByRole('dialog', { name: 'Set BoQ lines' });
    await linesDialog.getByLabel(new RegExp(itemCode)).fill('100');
    await linesDialog.getByRole('button', { name: 'Save lines' }).click();
    await expect(linesDialog).toBeHidden();
    await page.getByRole('button', { name: 'Issue lines' }).click();
    await confirm(page, 'Issue');
    await expect(page.getByRole('row', { name: new RegExp(itemCode) })).toContainText('100');
    await capture(page, testInfo, 'issued-lines');

    await page.getByRole('button', { name: 'Record acceptance' }).click();
    const acceptanceDialog = page.getByRole('dialog', { name: 'Record acceptance' });
    await acceptanceDialog.getByLabel('Signed acceptance document').selectOption({ value: docId });
    await acceptanceDialog.getByLabel(new RegExp(`${itemCode}.*verified to date`)).fill('120');
    await acceptanceDialog.getByRole('button', { name: 'Prepare acceptance' }).click();
    await expect(acceptanceDialog).toBeHidden();

    await signIn(page, 'finance@acme.test');
    await page.goto(`/procurement/${purchaseId}/items`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Review draft' }).click();
    const reviewDialog = page.getByRole('dialog', { name: 'Edit acceptance' });
    await reviewDialog.getByRole('button', { name: 'Confirm acceptance' }).click();
    await expect(reviewDialog).toBeHidden();
    await capture(page, testInfo, 'confirmed-acceptance');

    await page.getByRole('button', { name: 'Record another document' }).click();
    await page.getByRole('menuitem', { name: 'Supplier invoice' }).click();
    const firstBillLines = page.getByTestId('subcontract-bill-lines');
    const firstBillInput = firstBillLines.getByRole('textbox', { name: new RegExp(itemCode) });
    await expect(firstBillInput).toHaveValue('100');
    await firstBillInput.fill('120');
    await expect(firstBillLines.getByRole('status')).toContainText(new RegExp(`${itemCode}.*limited to 100`));
    await expect(firstBillInput).toHaveValue('100');
    await page.getByLabel('Tax treatment').selectOption({ value: 'exclusive' });
    await page.getByTestId('vi-tax-amount-input').fill('0');
    await page.getByTestId('btn-save-vi').click();
    await confirm(page, 'Save supplier invoice');
    const firstBillRow = page.getByTestId('subcontract-lines').getByRole('row', { name: new RegExp(itemCode) });
    await expect(firstBillRow.getByRole('cell').nth(4)).toHaveText('100', { timeout: 20_000 });
    await expect(firstBillRow.getByRole('cell').nth(5)).toHaveText('0');
    await expect(firstBillRow.getByRole('cell').nth(6)).toContainText('20');
    await capture(page, testInfo, 'first-bill-capped');

    const line = page.getByRole('row', { name: new RegExp(itemCode) });
    await expect(line).toContainText('0');
    await expect(line).toContainText('20');
    await page.getByRole('button', { name: 'Post-work' }).click();
    const variationDialog = page.getByRole('dialog', { name: 'Request PO variation' });
    await expect(variationDialog.getByLabel(/additional quantity/i)).toHaveValue('20');
    await variationDialog.getByLabel('Reason').fill('Verified additional concrete placement');
    await variationDialog.getByRole('button', { name: 'Request variation' }).click();
    await expect(variationDialog.getByRole('status')).toContainText(/decided by/i, { timeout: 15_000 });
    await capture(page, testInfo, 'variation-route');
    await variationDialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('po-variations')).toContainText('Requested');

    await signIn(page, 'exec@acme.test');
    await page.goto(`/procurement/${purchaseId}/items`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await confirm(page, 'Approve');
    await expect(page.getByTestId('po-variations')).toContainText('Approved');
    await capture(page, testInfo, 'variation-approved');

    await signIn(page, 'finance@acme.test');
    await page.goto(`/procurement/${purchaseId}/items`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Issue revision' }).click();
    await confirm(page, 'Issue revision');
    await expect(page.getByTestId('po-variations')).toContainText('Revised');
    await capture(page, testInfo, 'revision-issued');

    await page.getByRole('button', { name: 'Record another document' }).click();
    await page.getByRole('menuitem', { name: 'Supplier invoice' }).click();
    const secondBillInput = page.getByTestId('subcontract-bill-lines').getByRole('textbox', { name: new RegExp(itemCode) });
    await expect(secondBillInput).toHaveValue('20');
    await page.getByLabel('Tax treatment').selectOption({ value: 'exclusive' });
    await page.getByTestId('vi-tax-amount-input').fill('0');
    await capture(page, testInfo, 'second-bill-lines');
    await page.getByTestId('btn-save-vi').click();
    await confirm(page, 'Save supplier invoice');
    await expect(page.getByTestId('po-variations')).toContainText('Revised');

    const finalLine = page.getByTestId('subcontract-lines').getByRole('row', { name: new RegExp(itemCode) });
    await expect(finalLine.getByRole('cell').nth(4)).toHaveText('120', { timeout: 20_000 });
    await expect(finalLine.getByRole('cell').nth(5)).toHaveText('0');
    await expect(finalLine.getByRole('cell').nth(6)).toHaveText('0');
    await capture(page, testInfo, 'final-reconciliation');

    const bills = await admin.from('procurement_invoices').select('id, amount').eq('procurement_id', purchaseId).throwOnError();
    expect(bills.data).toHaveLength(2);
    expect(bills.data.reduce((total, bill) => total + Number(bill.amount), 0)).toBe(12_000_000);
    const issuedLines = await admin.from('purchase_order_lines').select('quantity').eq('po_id', poId).eq('revision', 2).eq('boq_item_id', boqItemId).throwOnError();
    expect(issuedLines.data).toHaveLength(1);
    const billedLines = await admin.from('procurement_invoice_lines').select('quantity').in('invoice_id', bills.data.map((bill) => bill.id)).eq('boq_item_id', boqItemId).throwOnError();
    expect(billedLines.data.reduce((total, billLine) => total + Number(billLine.quantity), 0)).toBeLessThanOrEqual(Number(issuedLines.data[0].quantity));
  } finally {
    // Issued PO revisions and their lines are append-only. Keep the ledger intact and archive the
    // unique project, matching the existing contract-quantities e2e fixture policy.
    await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId).throwOnError();
  }
});
