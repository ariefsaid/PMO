// @e2e-isolation: self-isolated — creates its own uniquely-named client company and VAT project each run, raises, approves and settles its own invoice, and deletes all of it afterwards; touches no shared seed row (the seed org's revenue is PMO-owned in this lane; only serial specs flip it, and they run after).
/**
 * AC-NAR-003 — #784, the one cross-stack journey for billing without an ERP. Finance raises an invoice on a VAT project
 * (12% on 11/12 → 1,110,000 gross); an Admin approves it from the Approvals queue (the second person, AC-NAR-002's
 * path); Finance records a part payment — the invoice reads Partly paid with 610,000 outstanding — then accepts the
 * amount the receipt form starts at (what is still owed, DD-NAR-17), and the invoice reads Paid.
 * Goal oracle: what the Sales Invoices list shows, to the people who act on it.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, pickComboboxOption } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(150_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let companyId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-NAR-003 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `NAR-003 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-NAR-003 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  // subject_to_vat defaults to true (0253); the recorded rate and base decide the invoice's PPN (DD-NAR-7).
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12,
    tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`AC-NAR-003 fixture project: ${project.error.message}`);
  projectId = project.data.id;
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-NAR-003 cleanup ${step}: ${e.message}`); };
  if (projectId) {
    const invoices = await admin.from('sales_invoices').select('id').eq('project_id', projectId);
    fail('invoice read', invoices.error);
    const ids = (invoices.data ?? []).map((r: { id: string }) => r.id);
    if (ids.length > 0) fail('receipts', (await admin.from('incoming_payments').delete().in('sales_invoice_id', ids)).error);
    fail('invoices', (await admin.from('sales_invoices').delete().eq('project_id', projectId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
    projectId = '';
  }
  if (companyId) {
    fail('company', (await admin.from('companies').delete().eq('id', companyId)).error);
    companyId = '';
  }
});

/** This run's invoice row on the Sales Invoices list, once the list has loaded. */
async function invoiceRow(page: Page) {
  await page.goto('/sales-invoices');
  const search = page.getByLabel('Search sales invoices');
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(`${tag} Client`);
  return page.getByRole('row').filter({ hasText: `${tag} Client` });
}

/** Records a receipt against this run's invoice; `amount` null accepts the amount the form starts at. */
async function recordReceipt(page: Page, amount: string | null) {
  await page.goto('/incoming-payments');
  await page.getByRole('button', { name: 'Receive Payment' }).first().click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^Customer/, new RegExp(`${tag} Client`));
  await pickComboboxOption(form, page, /^Sales Invoice/, /INV-\d{10}/);
  if (amount !== null) {
    await form.getByLabel(/Paid Amount/).fill(amount);
    await form.getByLabel(/Received Amount/).fill(amount);
  }
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
}

test('AC-NAR-003 a no-ERP org raises an invoice, a second person approves it, and part then full payment marks it Paid', async ({ page }) => {
  // Finance raises the invoice.
  await signIn(page, 'finance@acme.test');
  await page.goto('/sales-invoices');
  await page.getByRole('button', { name: 'New Invoice' }).first().click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^Customer/, new RegExp(`${tag} Client`));
  await pickComboboxOption(form, page, /^Project/, new RegExp(tag));
  await form.getByLabel(/Item code/).fill('SVC-NAR');
  await form.getByLabel('Description').fill('Site survey');
  await form.getByLabel(/Rate/).fill('1000000');
  await form.getByRole('button', { name: 'Create invoice' }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  let row = await invoiceRow(page);
  await expect(row.getByText('Draft', { exact: true })).toBeVisible({ timeout: 15_000 });

  // A second person — an Admin — approves it from the Approvals queue.
  await signIn(page, 'admin@acme.test');
  await page.goto('/approvals');
  const queue = page.getByRole('region', { name: 'Customer invoices awaiting you' });
  const item = queue.getByRole('listitem').filter({ hasText: `${tag} Client` });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Approve invoice' }).click();
  await expect(item).toHaveCount(0, { timeout: 15_000 });
  row = await invoiceRow(page);
  await expect(row.getByText('Unpaid', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/INV-\d{10}/);

  // Finance records a part payment, then the rest — the amount the form starts at.
  await signIn(page, 'finance@acme.test');
  await recordReceipt(page, '500000');
  row = await invoiceRow(page);
  await expect(row.getByText('Partly paid', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/610[.,]000/);
  await recordReceipt(page, null);
  row = await invoiceRow(page);
  await expect(row.getByText('Paid', { exact: true })).toBeVisible({ timeout: 15_000 });
});
