// @e2e-isolation: self-isolated — creates its own uniquely-named client and two approved PMO invoices each run, records, applies and unapplies its own payment, and deletes all of it afterwards; touches no shared seed row.
/**
 * AC-NPA-001 — #1415, the one cross-stack journey for applying a payment without an ERP. A customer pays 1,000 up front
 * with no invoice (a payment on account); Finance applies it across two invoices (600 + 400) and both read Paid; then
 * takes the 400 back off and that invoice owes it again.
 * Goal oracle: what the Sales Invoices list shows for each invoice, to the people who act on it.
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
let companyId = '';
let tag = '';
let numbers: string[] = [];
const localized = (en: string, id: string) => new RegExp(`(?:${en}|${id})`, 'i');
const localizedExact = (en: string, id: string) => new RegExp(`^(?:${en}|${id})$`, 'i');

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-NPA-001 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `NPA-001 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-NPA-001 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const stamp = String(Date.now()).slice(-8);
  numbers = [`INV-70${stamp}`, `INV-71${stamp}`];
  const invoices = await admin.from('sales_invoices').insert([600, 400].map((gross, i) => ({
    org_id: ORG_ID, customer_id: companyId, pmo_number: numbers[i], invoice_date: '2026-07-01', amount: gross, tax_treatment: 'inclusive',
    tax_amount: 0, currency: 'USD', status: 'Unpaid', pmo_native: true, native_lines: [{ description: `${tag} line ${i}`, qty: 1, rate: gross }],
    erp_outstanding_amount: gross, overpaid_amount: 0,
  })));
  if (invoices.error) throw new Error(`AC-NPA-001 fixture invoices: ${invoices.error.message}`);
});

test.afterEach(async () => {
  if (!admin || !companyId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-NPA-001 cleanup ${step}: ${e.message}`); };
  const receipts = await admin.from('incoming_payments').select('id').eq('customer_id', companyId);
  fail('receipt read', receipts.error);
  const ids = (receipts.data ?? []).map((r: { id: string }) => r.id);
  if (ids.length > 0) fail('allocations', (await admin.from('incoming_payment_allocations').delete().in('incoming_payment_id', ids)).error);
  if (ids.length > 0) fail('receipts', (await admin.from('incoming_payments').delete().in('id', ids)).error);
  fail('invoices', (await admin.from('sales_invoices').delete().eq('customer_id', companyId)).error);
  fail('company', (await admin.from('companies').delete().eq('id', companyId)).error);
  companyId = '';
});

/** The status text of one of this run's invoices on the Sales Invoices list. */
async function invoiceRow(page: Page, number: string) {
  await page.goto('/sales-invoices');
  const search = page.getByLabel(localized('Search sales invoices', 'Cari faktur penjualan'));
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(number);
  return page.getByRole('row').filter({ hasText: number });
}

test('AC-NPA-001 a payment on account is applied across two invoices, both read Paid, and taking one off makes it owe again', async ({ page }) => {
  await signIn(page, 'finance@acme.test');

  // The customer pays 1,000 with no invoice named.
  await page.goto('/finance/receivables?view=payments');
  await page.getByRole('button', { name: localized('Receive Payment', 'Terima Pembayaran') }).click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^(?:Customer|Pelanggan)/, new RegExp(`${tag} Client`));
  await form.getByLabel(localized('Amount settled', 'Jumlah yang dilunasi')).fill('1000');
  await form.getByLabel(localized('Cash received', 'Kas diterima')).fill('1000');
  await form.getByRole('button', { name: localized('Record payment', 'Catat pembayaran') }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });

  // Open that payment and apply it: 600 to the first invoice, 400 to the second.
  await page.goto('/incoming-payments');
  await page.getByLabel(localized('Search incoming payments', 'Cari pembayaran masuk')).fill(`${tag} Client`);
  const receiptRow = page.getByRole('row').filter({ hasText: `${tag} Client` });
  await expect(receiptRow).toBeVisible({ timeout: 15_000 });
  await receiptRow.getByRole('button', { name: /^(?:Open|Buka) RCV-\d{10}$/ }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: localized('Apply to invoices', 'Terapkan ke faktur') }).click();
  const apply = page.getByRole('dialog', { name: localized('Apply to invoices', 'Terapkan ke faktur') });
  await pickComboboxOption(apply, page, /^(?:Invoice|Faktur)$/, new RegExp(numbers[0]));
  await apply.getByLabel(/^(?:Amount|Jumlah)$/).first().fill('600');
  await apply.getByRole('button', { name: localized('Add another invoice', 'Tambah faktur lain') }).click();
  await pickComboboxOption(apply.getByRole('listitem').nth(1), page, /^(?:Invoice|Faktur)$/, new RegExp(numbers[1]));
  await apply.getByLabel(/^(?:Amount|Jumlah)$/).nth(1).fill('400');
  await apply.getByRole('button', { name: localized('Apply', 'Terapkan'), exact: true }).click();
  await expect(apply).toBeHidden({ timeout: 15_000 });

  // Both invoices read Paid.
  for (const number of numbers) {
    const row = await invoiceRow(page, number);
    await expect(row.getByText(localizedExact('Paid', 'Dibayar'))).toBeVisible({ timeout: 15_000 });
  }

  // Take the 400 back off the second invoice: it owes it again, the first is untouched.
  await page.goto('/incoming-payments');
  await page.getByLabel(localized('Search incoming payments', 'Cari pembayaran masuk')).fill(`${tag} Client`);
  await page.getByRole('row').filter({ hasText: `${tag} Client` }).getByRole('button', { name: /^(?:Open|Buka) RCV-\d{10}$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`(?:Unapply|Batalkan penerapan) ${numbers[1]}`) }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: localized('Unapply', 'Batalkan penerapan'), exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden({ timeout: 15_000 });

  let row = await invoiceRow(page, numbers[1]);
  await expect(row.getByText(localizedExact('Paid', 'Dibayar'))).toHaveCount(0, { timeout: 15_000 });
  await expect(row).toContainText(/400/);
  row = await invoiceRow(page, numbers[0]);
  await expect(row.getByText(localizedExact('Paid', 'Dibayar'))).toBeVisible({ timeout: 15_000 });
});
