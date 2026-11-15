// @e2e-isolation: self-isolated — each journey creates its own organisation, users, project and purchase; issued PO lines and bills are append-only, so the organisation is removed whole at the end (pass or fail).
/** AC-SCV-009 — goal: where PMO owns the books (an organisation with no ERP binding), a mistyped subcontract bill is voided by a second Admin/Finance user, the PO line is payable again, and the corrected bill is captured. In an ERP-bound organisation the control is not offered, and the server refusal (AC-SCV-009b, called directly) reads in plain words and leaves the bill live. */
import { execFileSync, execSync } from 'node:child_process';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, SEED_PASSWORD } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import type { Database } from '../src/lib/supabase/database.types';
import { voidBillErrorText } from '../pages/procurement/subcontractBillError';
import type { TFunction } from 'i18next';
import { AppError } from '../src/lib/appError';

test.setTimeout(180_000);

function readSupabaseEnv(name: string): string {
  const output = execSync('supabase status -o env', { encoding: 'utf8' });
  const match = output.match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
  if (!match) throw new Error(`Missing ${name} from supabase status -o env`);
  return match[1];
}

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

/** Row counts of every table the fixture writes, so a spec can show it left nothing behind. */
const COUNTED_TABLES = ['organizations', 'profiles', 'companies', 'projects', 'budget_versions', 'budget_line_items', 'boq_items', 'procurements', 'purchase_orders', 'project_documents', 'procurement_invoices'] as const;
async function rowCounts(admin: SupabaseClient<Database>) {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).throwOnError();
    counts[table] = count ?? 0;
  }
  let users = 0;
  for (let page = 1; ; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    users += data.users.length;
    if (data.users.length < 200) break;
  }
  counts['auth.users'] = users;
  return counts;
}

/**
 * Removes a fresh fixture organisation, its users and every row under it. Bills and PO lines are append-only to every
 * app role, so this runs as the local database superuser with triggers off (the same route AC-BUPOT-020 takes).
 */
function removeFixtureOrg(own: { orgId: string; ids: Record<string, string> }): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const userIds = Object.values(own.ids);
  if (![own.orgId, ...userIds].every((id) => uuid.test(id))) throw new Error('AC-SCV-009 cleanup refused a non-UUID parameter');
  const sql = `
BEGIN;
SET LOCAL session_replication_role = replica;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables x
      ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND c.table_name <> 'profiles'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE org_id = %L', t, '${own.orgId}');
  END LOOP;
END $$;
DELETE FROM public.profiles WHERE org_id = '${own.orgId}';
DELETE FROM auth.users WHERE id IN (${userIds.map((id) => `'${id}'`).join(',')});
DELETE FROM public.organizations WHERE id = '${own.orgId}';
COMMIT;`;
  execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
}

const ROLES: Record<Actor, string> = { pm: 'Project Manager', exec: 'Executive', finance: 'Finance', admin: 'Admin' };

/** A fresh tenant with its own four actors; `bound` gives it an active ERP binding (the books are kept there), otherwise PMO owns the books. */
async function createFixtureOrg(admin: SupabaseClient<Database>, suffix: string, bound: boolean) {
  const orgId = crypto.randomUUID();
  await admin.from('organizations').insert({
    id: orgId, name: `SCV-009 ${bound ? 'ERP-bound' : 'PMO-owned'} org ${suffix}`, default_currency: 'IDR', default_timezone: 'UTC', default_locale: 'en', lifecycle_state: 'test',
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
  if (bound) {
    await admin.from('external_org_bindings').insert({
      org_id: orgId, external_tier: 'erpnext', site_url: 'http://localhost:1', secret_ref: `scv009-fixture-${suffix}`, status: 'active',
    }).throwOnError();
  }
  const bindings = await admin.from('external_org_bindings').select('id').eq('org_id', orgId).eq('status', 'active');
  expect(bindings.data ?? []).toHaveLength(bound ? 1 : 0);
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

  let own: Awaited<ReturnType<typeof createFixtureOrg>> | null = null;
  try {
    // A fresh organisation per journey, with its own actors: bound (an active ERP binding) or PMO-owned (none). It is removed at the end.
    own = await createFixtureOrg(admin, suffix, bound);
    const as = (actor: Actor) => formSignIn(page, own!.emails[actor]);
    const pm = { data: { id: own.ids.pm, org_id: own.orgId } };
    const orgId = own.orgId;
    const execId = own.ids.exec;

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
      // In an ERP-bound organisation the second Admin is not offered the control at all ...
      await as('admin');
      await page.goto(`/procurement/${purchaseId}/files`);
      const ledger = page.getByTestId('procurement-ledger');
      await expect(ledger).toBeVisible({ timeout: 20_000 });
      const billRow = ledger.getByRole('row', { name: new RegExp(viNumber) });
      await expect(billRow).toBeVisible();
      await billRow.hover();
      const rowActions = billRow.getByRole('button', { name: 'Row actions' });
      if (await rowActions.count() > 0) {
        await rowActions.click();
        await expect(page.getByRole('menuitem', { name: 'Void bill' })).toHaveCount(0);
        await page.keyboard.press('Escape');
      }
      await capture(page, testInfo, 'erp-bound-no-control');

      // ... and the server still refuses the void, in words, when called directly as that Admin; the bill stays live.
      const caller = createClient<Database>(url, readSupabaseEnv('ANON_KEY'), { auth: { persistSession: false } });
      const signedIn = await caller.auth.signInWithPassword({ email: own.emails.admin, password: SEED_PASSWORD });
      if (signedIn.error) throw signedIn.error;
      const refused = await caller.rpc('void_subcontract_bill', { p_invoice_id: mistyped.data.id, p_reason: voidReason });
      expect(refused.data).toBeNull();
      expect(refused.error).not.toBeNull();
      const words = voidBillErrorText(new AppError(refused.error!.message, refused.error!.code, refused.error!.details ?? undefined), ((_key: string, fallback?: string) => fallback ?? _key) as unknown as TFunction);
      expect(words).toBe('Your organisation records bills in its ERP. Cancel the bill there.');
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
    // Issued PO lines and bills are append-only to every app role, so the fresh organisation is removed whole, with its users,
    // by the local database superuser. Runs on pass and on fail.
    if (own) removeFixtureOrg(own);
  }
}

test('AC-SCV-009 where PMO owns the books, a second Admin/Finance user voids a mistyped subcontract bill from the ledger; the line is payable again and the corrected bill is captured', async ({ page }, testInfo) => {
  await setUpAndRun(page, testInfo, false);
});

test('AC-SCV-009b in an ERP-bound organisation, voiding a subcontract bill is refused in plain words and the bill stays live', async ({ page }, testInfo) => {
  await setUpAndRun(page, testInfo, true);
});

// The fixture must leave nothing behind: the table counts are printed before and after, and the fresh organisation's own rows are gone.
test.describe.configure({ mode: 'serial' });
let before: Record<string, number> = {};
test.beforeAll(async () => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-SCV-009 requires the local fixture service client');
  const admin = createClient<Database>(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  before = await rowCounts(admin);
  console.log('AC-SCV-009 row counts BEFORE', JSON.stringify(before));
});
test.afterAll(async () => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) return;
  const admin = createClient<Database>(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const after = await rowCounts(admin);
  console.log('AC-SCV-009 row counts AFTER ', JSON.stringify(after));
  const orgs = await admin.from('organizations').select('id', { count: 'exact', head: true }).like('name', 'SCV-009 %org%');
  const profiles = await admin.from('profiles').select('id', { count: 'exact', head: true }).like('email', 'scv009-%');
  expect(orgs.count).toBe(0);
  expect(profiles.count).toBe(0);
  for (const key of ['organizations', 'profiles', 'auth.users']) expect(after[key], `${key} count`).toBe(before[key]);
});
