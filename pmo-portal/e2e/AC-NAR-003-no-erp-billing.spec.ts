// @e2e-isolation: self-isolated — creates its own uniquely-named client company and VAT project each run, raises, approves and settles its own invoice, and deletes all of it afterwards; touches no shared seed row (the seed org's revenue is PMO-owned in this lane; only serial specs flip it, and they run after).
/**
 * AC-NAR-003 — #784, the one cross-stack journey for billing without an ERP. Finance raises an invoice on a VAT project
 * (12% on 11/12 → 1,110,000 gross); an Admin opens it on the Approvals queue, reads the whole invoice and approves it
 * (the second person, AC-NAR-002's path); Finance records a part payment — the invoice reads Partly paid with 610,000
 * outstanding — then a receipt above what is still owed (the form starts at the 610,000 balance, DD-NAR-17), and the
 * invoice reads Paid with the 90,000 excess shown as overpaid.
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
let financeName = '';
const localized = (en: string, id: string) => new RegExp(`(?:${en}|${id})`, 'i');
const localizedExact = (en: string, id: string) => new RegExp(`^(?:${en}|${id})$`, 'i');

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
  const author = await admin.from('profiles').select('full_name').eq('email', 'finance@acme.test').single();
  if (author.error) throw new Error(`AC-NAR-003 fixture author: ${author.error.message}`);
  financeName = author.data.full_name;
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
  const search = page.getByLabel(localized('Search sales invoices', 'Cari faktur penjualan'));
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(`${tag} Client`);
  return page.getByRole('row').filter({ hasText: `${tag} Client` });
}

/** Records a receipt against this run's invoice; `startsAt` is the balance the form must start at (DD-NAR-17). */
async function recordReceipt(page: Page, amount: string, startsAt?: RegExp) {
  await page.goto('/incoming-payments');
  await page.getByRole('button', { name: localized('Receive Payment', 'Terima Pembayaran') }).first().click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^(?:Customer|Pelanggan)/, new RegExp(`${tag} Client`));
  await pickComboboxOption(form, page, /^(?:Sales Invoice|Faktur Penjualan)/, /INV-\d{10}/);
  if (startsAt) await expect(form.getByLabel(localized('Paid Amount', 'Jumlah Dibayar'))).toHaveValue(startsAt);
  await form.getByLabel(localized('Paid Amount', 'Jumlah Dibayar')).fill(amount);
  await form.getByLabel(localized('Received Amount', 'Jumlah Diterima')).fill(amount);
  await form.getByRole('button', { name: localized('Record payment', 'Catat pembayaran') }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
}

test('AC-NAR-003 a no-ERP org raises an invoice, a second person approves it after reading it, and part then over payment marks it Paid', async ({ page }) => {
  // Finance raises the invoice.
  await signIn(page, 'finance@acme.test');
  await page.goto('/sales-invoices');
  await page.getByRole('button', { name: localized('New Invoice', 'Faktur Baru') }).first().click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^(?:Customer|Pelanggan)/, new RegExp(`${tag} Client`));
  await pickComboboxOption(form, page, /^(?:Project|Proyek)/, new RegExp(tag));
  await form.getByLabel(localized('Item code', 'Kode item')).fill('SVC-NAR');
  await form.getByLabel(localized('Description', 'Deskripsi')).fill('Site survey');
  await form.getByLabel(localized('Rate', 'Tarif')).fill('1000000');
  await form.getByRole('button', { name: localized('Create invoice', 'Buat faktur') }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  let row = await invoiceRow(page);
  await expect(row.getByText(localizedExact('Draft', 'Draf'))).toBeVisible({ timeout: 15_000 });

  // A second person — an Admin — approves it from the Approvals queue.
  await signIn(page, 'admin@acme.test');
  await page.goto('/approvals');
  const queue = page.getByRole('region', { name: localized('Customer invoices awaiting you', 'Faktur pelanggan yang menunggu Anda') });
  const item = queue.getByRole('listitem').filter({ hasText: `${tag} Client` });
  await expect(item).toBeVisible({ timeout: 15_000 });
  // I-1: the approver reads the invoice before approving it — project, customer, the line, who raised it, the total due.
  await item.getByRole('button', { name: new RegExp(`(?:Show invoice details for|Tampilkan detail faktur untuk) ${tag} Client`, 'i') }).click();
  await expect(item.getByRole('link', { name: new RegExp(tag) })).toBeVisible();
  await expect(item.getByRole('list', { name: localized('Line items', 'Item faktur') })).toContainText('Site survey');
  await expect(item.getByRole('list', { name: localized('Line items', 'Item faktur') })).toContainText('SVC-NAR');
  await expect(item).toContainText(financeName);
  await expect(item).toContainText(/(?:Total due|Total tagihan)\s*\S*\s?1[.,]110[.,]000/i);
  await item.getByRole('button', { name: localized('Approve', 'Setujui') }).click();
  await page.getByRole('button', { name: localized('Approve invoice', 'Setujui faktur') }).click();
  await expect(item).toHaveCount(0, { timeout: 15_000 });
  row = await invoiceRow(page);
  await expect(row.getByText(localizedExact('Unpaid', 'Belum dibayar'))).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/INV-\d{10}/);

  // Finance records a part payment, then more than is still owed.
  await signIn(page, 'finance@acme.test');
  await recordReceipt(page, '500000');
  row = await invoiceRow(page);
  await expect(row.getByText(localizedExact('Partly paid', 'Dibayar sebagian'))).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/610[.,]000/);
  await recordReceipt(page, '700000', /^610[.,]000$/);
  row = await invoiceRow(page);
  await expect(row.getByText(localizedExact('Paid', 'Dibayar'))).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/(?:Overpaid by|Kelebihan bayar)\s*\S*\s?90[.,]000/i);
});
