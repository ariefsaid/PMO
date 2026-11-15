// @e2e-isolation: self-isolated — each journey creates its own project and purchase (the void journey also its own organisation and users); issued PO lines and bills are append-only, so it archives the fixture project afterwards.
/** AC-SCV-009 — goal: where PMO owns the books (an organisation with no ERP binding), a mistyped subcontract bill is voided by a second Admin/Finance user, the PO line is payable again, and the corrected bill is captured. An ERP-bound organisation is refused in plain words and the bill stays live. */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn, SEED_PASSWORD } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import type { Database } from '../src/lib/supabase/database.types';

test.setTimeout(180_000);

async function confirm(page: Page, label: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: label, exact: true }).click();
}

async function capture(page: Page, testInfo: TestInfo, state: string) {
  await page.screenshot({ path: testInfo.outputPath(`subcontract-void-${state}.png`), fullPage: true });
}

async function captureBill(page: Page, itemCode: string, quantity: string) {
  await page.getByRole('button', { name: 'Record another document' }).click();
  await page.getByRole('menuitem', { name: 'Supplier invoice' }).click();
  const billInput = page.getByTestId('subcontract-bill-lines').getByRole('textbox', { name: new RegExp(itemCode) });
  await billInput.fill(quantity);
  await expect(billInput).toHaveValue(quantity);
  await page.getByLabel('Tax treatment').selectOption({ value: 'exclusive' });
  await page.getByTestId('vi-tax-amount-input').fill('0');
  await page.getByTestId('btn-save-vi').click();
  await confirm(page, 'Save supplier invoice');
}

type Actor = 'pm' | 'exec' | 'finance' | 'admin';

/** Real form sign-in for a user created inside a fixture organisation (the captured seed sessions only cover seed users). */
async function formSignIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

const ROLES: Record<Actor, string> = { pm: 'Project Manager', exec: 'Executive', finance: 'Finance', admin: 'Admin' };

/** A tenant with no ERP binding and its own four actors: PMO owns the books there. */
async function createPmoOwnedOrg(admin: SupabaseClient<Database>, suffix: string) {
  const orgId = crypto.randomUUID();
  await admin.from('organizations').insert({
    id: orgId, name: `SCV-009 PMO-owned org ${suffix}`, default_currency: 'IDR', default_timezone: 'UTC', default_locale: 'en', lifecycle_state: 'test',
  }).throwOnError();
  const ids = {} as Record<Actor, string>;
  const emails = {} as Record<Actor, string>;
  for (const actor of Object.keys(ROLES) as Actor[]) {
    const email = `scv009-${actor}-${suffix.toLowerCase()}@acme.test`;
    const created = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`AC-SCV-009 could not create the ${actor} user: ${created.error?.message}`);
    ids[actor] = created.data.user.id;
    emails[actor] = email;
    await admin.from('profiles').insert({
      id: ids[actor], org_id: orgId, email, full_name: `SCV ${actor} ${suffix}`, role: ROLES[actor] as 'Admin', status: 'active', locale: 'en', timezone: 'UTC',
    }).throwOnError();
  }
  const bindings = await admin.from('external_org_bindings').select('id').eq('org_id', orgId).eq('status', 'active');
  expect(bindings.data ?? []).toHaveLength(0);
  return { orgId, ids, emails };
}

async function setUpAndRun(page: Page, testInfo: TestInfo, bound: boolean) {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-SCV-009 requires the local fixture service client');
  const url = requireMatchingLocalSupabaseUrls(undefined, undefined);
  const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
  const suffix = `SCV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = crypto.randomUUID();
  const purchaseId = crypto.randomUUID();
  const poId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const itemCode = `L1-${suffix}`;
  const voidReason = `Typed 100 instead of 40 ${suffix}`;

  try {
    // Bound: the seed organisation (active ERP binding). PMO-owned: a fresh organisation with no binding and its own actors.
    const own = bound ? null : await createPmoOwnedOrg(admin, suffix);
    const as = async (actor: Actor) => {
      if (own) return formSignIn(page, own.emails[actor]);
      return signIn(page, `${actor}@acme.test`);
    };
    const [pm, executive] = own
      ? [{ data: { id: own.ids.pm, org_id: own.orgId } }, { data: { id: own.ids.exec } }]
      : await Promise.all([
        admin.from('profiles').select('id, org_id').eq('email', 'pm@acme.test').single().throwOnError(),
        admin.from('profiles').select('id').eq('email', 'exec@acme.test').single().throwOnError(),
      ]);
    const orgId = pm.data.org_id;
    const execId = executive.data.id;
    const bindings = await admin.from('external_org_bindings').select('id').eq('org_id', orgId).eq('status', 'active').throwOnError();
    if (bound && (bindings.data ?? []).length === 0) throw new Error('AC-SCV-009 the ERP-bound journey needs the seed organisation to have an active ERP binding');

    const vendorId = (await admin.from('companies').insert({ org_id: orgId, name: `Subcontract vendor ${suffix}`, type: 'Vendor' }).select('id').single().throwOnError()).data.id;
    await admin.from('projects').insert({
      id: projectId, org_id: orgId, name: `Subcontract void project ${suffix}`, status: 'Ongoing Project', currency: 'IDR',
      project_manager_id: pm.data.id,
    }).throwOnError();
    const version = await admin.from('budget_versions').insert({ org_id: orgId, project_id: projectId, name: `SCV budget ${suffix}`, version: 1, status: 'Draft', currency: 'IDR' }).select('id').single().throwOnError();
    await admin.from('budget_line_items').insert({ org_id: orgId, budget_version_id: version.data.id, category: 'Subcontractors', budgeted_amount: 20_000_000 }).throwOnError();
    await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.data.id).throwOnError();
    await admin.from('boq_items').insert({
      org_id: orgId, project_id: projectId, item_code: itemCode, description: `Concrete placement ${suffix}`, unit: 'm3', quantity: 100, rate: 100_000,
    }).throwOnError();
    await admin.from('procurements').insert({
      id: purchaseId, org_id: orgId, project_id: projectId, title: `Subcontract void ${suffix}`, status: 'Ordered', currency: 'IDR',
      total_value: 10_000_000, approved_total_value: 10_000_000, requested_by_id: pm.data.id,
      approved_by_id: execId, amount_approved_by_id: execId, budget_category: 'Subcontractors', vendor_id: vendorId, is_subcontract: true,
    }).throwOnError();
    await admin.from('purchase_orders').insert({
      id: poId, org_id: orgId, procurement_id: purchaseId, status: 'Issued', amount: 10_000_000, currency: 'IDR', po_number: `PO-${suffix}`,
    }).throwOnError();
    await admin.from('project_documents').insert({
      id: docId, org_id: orgId, project_id: projectId, category: 'Handover', title: `Signed acceptance ${suffix}`, status: 'Issued',
      file_path: `${orgId}/${projectId}/${docId}/acceptance.pdf`, code: `ACC-${suffix}`,
    }).throwOnError();

    // Given: the PM issues 100 m3 on the PO and records the signed acceptance of all 100.
    await as('pm');
    await page.goto(`/procurement/${purchaseId}/items`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Set BoQ lines' }).click();
    const linesDialog = page.getByRole('dialog', { name: 'Set BoQ lines' });
    await linesDialog.getByLabel(new RegExp(itemCode)).fill('100');
    await linesDialog.getByRole('button', { name: 'Save lines' }).click();
    await expect(linesDialog).toBeHidden();
    await page.getByRole('button', { name: 'Issue lines' }).click();
    await confirm(page, 'Issue');
    await page.getByRole('button', { name: 'Record acceptance' }).click();
    const acceptanceDialog = page.getByRole('dialog', { name: 'Record acceptance' });
    await acceptanceDialog.getByLabel('Signed acceptance document').selectOption({ value: docId });
    await acceptanceDialog.getByLabel(new RegExp(`${itemCode}.*verified to date`)).fill('100');
    await acceptanceDialog.getByRole('button', { name: 'Prepare acceptance' }).click();
    await expect(acceptanceDialog).toBeHidden();

    // Finance confirms the acceptance, then mistypes the bill: all 100 instead of the 40 the vendor invoiced.
    await as('finance');
    await page.goto(`/procurement/${purchaseId}/items`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Review draft' }).click();
    const reviewDialog = page.getByRole('dialog', { name: 'Edit acceptance' });
    await reviewDialog.getByRole('button', { name: 'Confirm acceptance' }).click();
    await expect(reviewDialog).toBeHidden();
    await captureBill(page, itemCode, '100');
    const lineRow = () => page.getByTestId('subcontract-lines').getByRole('row', { name: new RegExp(itemCode) });
    await expect(lineRow().getByRole('cell').nth(4)).toHaveText('100', { timeout: 20_000 });
    await expect(lineRow().getByRole('cell').nth(5)).toHaveText('0');
    await capture(page, testInfo, 'mistyped-bill');

    const mistyped = await admin.from('procurement_invoices').select('id, vi_number').eq('procurement_id', purchaseId).single().throwOnError();
    const viNumber = mistyped.data.vi_number;
    if (!viNumber) throw new Error('AC-SCV-009 the captured bill has no system number to find on the ledger');

    if (bound) {
      // When an ERP-bound organisation's second Admin tries the same void, the app says why in words and the bill stays live.
      await as('admin');
      await page.goto(`/procurement/${purchaseId}/files`);
      const ledger = page.getByTestId('procurement-ledger');
      await expect(ledger).toBeVisible({ timeout: 20_000 });
      const billRow = ledger.getByRole('row', { name: new RegExp(viNumber) });
      await billRow.hover();
      await billRow.getByRole('button', { name: 'Row actions' }).click();
      await page.getByRole('menuitem', { name: 'Void bill' }).click();
      const voidDialog = page.getByRole('alertdialog');
      await voidDialog.getByLabel(/Why is this bill being voided\?/).fill(voidReason);
      await voidDialog.getByRole('button', { name: 'Void bill', exact: true }).click();
      await expect(voidDialog).toContainText('Your organisation records bills in its ERP. Cancel the bill there.', { timeout: 15_000 });
      await capture(page, testInfo, 'erp-bound-refusal');
      const bill = await admin.from('procurement_invoices').select('voided_at').eq('id', mistyped.data.id).single().throwOnError();
      expect(bill.data.voided_at).toBeNull();
      return;
    }

    // When: a second Admin/Finance user (not the bill's author) voids it from the purchase ledger, with a reason.
    await as('admin');
    await page.goto(`/procurement/${purchaseId}/files`);
    const ledger = page.getByTestId('procurement-ledger');
    await expect(ledger).toBeVisible({ timeout: 20_000 });
    const billRow = ledger.getByRole('row', { name: new RegExp(viNumber) });
    await billRow.hover();
    await billRow.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Void bill' }).click();
    const voidDialog = page.getByRole('alertdialog');
    await voidDialog.getByLabel(/Why is this bill being voided\?/).fill(voidReason);
    await voidDialog.getByRole('button', { name: 'Void bill', exact: true }).click();
    await expect(voidDialog).toBeHidden({ timeout: 15_000 });
    await expect(billRow).toContainText('Voided');
    await expect(billRow).toContainText(voidReason);
    await capture(page, testInfo, 'voided-bill');

    // Then: the PO line's payable returns ...
    await page.goto(`/procurement/${purchaseId}/items`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
    await expect(lineRow().getByRole('cell').nth(4)).toHaveText('0', { timeout: 20_000 });
    await expect(lineRow().getByRole('cell').nth(5)).toHaveText('100');
    await capture(page, testInfo, 'payable-restored');

    // ... and the corrected bill can be captured.
    await captureBill(page, itemCode, '40');
    await expect(lineRow().getByRole('cell').nth(4)).toHaveText('40', { timeout: 20_000 });
    await expect(lineRow().getByRole('cell').nth(5)).toHaveText('60');
    await capture(page, testInfo, 'corrected-bill');

    const bills = await admin.from('procurement_invoices').select('id, voided_at, void_reason').eq('procurement_id', purchaseId).throwOnError();
    expect(bills.data).toHaveLength(2);
    const voided = bills.data.find((bill) => bill.id === mistyped.data.id)!;
    expect(voided.voided_at).not.toBeNull();
    expect(voided.void_reason).toBe(voidReason);
    expect(bills.data.filter((bill) => bill.voided_at == null)).toHaveLength(1);
  } finally {
    // Issued PO lines and bills are append-only (a void keeps the row). Archive the unique fixture project.
    await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId).throwOnError();
  }
}

test('AC-SCV-009 where PMO owns the books, a second Admin/Finance user voids a mistyped subcontract bill from the ledger; the line is payable again and the corrected bill is captured', async ({ page }, testInfo) => {
  await setUpAndRun(page, testInfo, false);
});

test('AC-SCV-009b in an ERP-bound organisation, voiding a subcontract bill is refused in plain words and the bill stays live', async ({ page }, testInfo) => {
  await setUpAndRun(page, testInfo, true);
});
