// @e2e-isolation: self-isolated — creates its own uniquely-named client, VAT project, contract lines and evidence document each run, bills, approves and settles its own claim, and deletes all of it afterwards; touches no shared seed row.
/**
 * AC-NAR-045 — #2465, the one cross-stack journey for billing a progress claim without an ERP. Finance makes a claim from the
 * project's contract lines, attaches its evidence and creates its invoice in PMO; the invoice is a Draft that the claim's
 * author cannot approve; an Admin reads it on the Approvals queue and approves it (the second person); Finance records the
 * payment. Goal oracle: the project's billed work moves once (when the invoice is approved), and paying it does not move it again.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, pickComboboxOption } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let companyId = '';
let documentId = '';
let tag = '';
const localized = (en: string, id: string) => new RegExp(`(?:${en}|${id})`, 'i');
const localizedExact = (en: string, id: string) => new RegExp(`^(?:${en}|${id})$`, 'i');

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-NAR-045 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `NAR-045 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-NAR-045 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12,
    tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`AC-NAR-045 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const line = await admin.from('boq_items').insert({
    org_id: ORG_ID, project_id: projectId, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50_000,
  });
  if (line.error) throw new Error(`AC-NAR-045 fixture contract line: ${line.error.message}`);
  documentId = randomUUID();
  const evidence = await admin.from('project_documents').insert({
    id: documentId, org_id: ORG_ID, project_id: projectId, category: 'Report', title: `${tag} progress report`, revision: 'A',
    status: 'Approved', file_path: `${ORG_ID}/${projectId}/${documentId}/report.pdf`,
  });
  if (evidence.error) throw new Error(`AC-NAR-045 fixture evidence: ${evidence.error.message}`);
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-NAR-045 cleanup ${step}: ${e.message}`); };
  if (projectId) {
    const invoices = await admin.from('sales_invoices').select('id').eq('project_id', projectId);
    fail('invoice read', invoices.error);
    const ids = (invoices.data ?? []).map((r: { id: string }) => r.id);
    if (ids.length > 0) {
      const receipts = await admin.from('incoming_payments').select('id').in('sales_invoice_id', ids);
      fail('receipt read', receipts.error);
      const receiptIds = (receipts.data ?? []).map((r: { id: string }) => r.id);
      if (receiptIds.length > 0) fail('allocations', (await admin.from('incoming_payment_allocations').delete().in('incoming_payment_id', receiptIds)).error);
      fail('receipts', (await admin.from('incoming_payments').delete().in('sales_invoice_id', ids)).error);
    }
    fail('invoices', (await admin.from('sales_invoices').delete().eq('project_id', projectId)).error);
    const claims = await admin.from('progress_claims').select('id').eq('project_id', projectId);
    fail('claim read', claims.error);
    const claimIds = (claims.data ?? []).map((r: { id: string }) => r.id);
    if (claimIds.length > 0) {
      fail('evidence', (await admin.from('progress_claim_evidence').delete().in('claim_id', claimIds)).error);
      fail('claims', (await admin.from('progress_claims').delete().in('id', claimIds)).error);
    }
    fail('documents', (await admin.from('project_documents').delete().eq('project_id', projectId)).error);
    fail('contract lines', (await admin.from('boq_items').delete().eq('project_id', projectId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
    projectId = '';
  }
  if (companyId) {
    fail('company', (await admin.from('companies').delete().eq('id', companyId)).error);
    companyId = '';
  }
});

/** The project's "Billed" figure on its Billing tab (bare number, as the tab prints it). */
async function billedWork(page: Page): Promise<string> {
  await page.goto(`/projects/${projectId}/billing`);
  const figure = page.getByTestId('billing-billed');
  await expect(figure).toBeVisible({ timeout: 15_000 });
  return (await figure.innerText()).replace(/\D/g, '');
}

test('AC-NAR-045 a no-ERP org bills a progress claim: claim, evidence, PMO invoice, a second person approves, payment received, billed work moves once', async ({ page }) => {
  // Finance makes the claim from the contract lines: 4 km of 10 → 200,000 excl. PPN.
  await signIn(page, 'finance@acme.test');
  expect(await billedWork(page)).toBe('0');
  const summary = page.getByRole('heading', { name: /Billing summary|Ringkasan penagihan/ }).locator('xpath=ancestor::*[self::div or self::section][2]');
  await summary.getByRole('button', { name: localized('Raise invoice', 'Terbitkan invoice|Ajukan faktur') }).click();
  await page.getByRole('button', { name: localized('Quantity or progress claim', 'Klaim kuantitas atau progres|Klaim kuantitas') }).click();
  const claimForm = page.getByRole('dialog');
  await claimForm.getByLabel(/SURVEY/).fill('4');
  await claimForm.getByRole('button', { name: localized('Create claim', 'Buat tagihan') }).click();

  // The next step is the evidence.
  const evidenceForm = page.getByRole('dialog');
  await evidenceForm.getByLabel(localized('Evidence document', 'Dokumen bukti')).selectOption(documentId);
  await evidenceForm.getByRole('button', { name: localized('Attach', 'Lampirkan') }).click();
  await expect(evidenceForm).toBeHidden({ timeout: 15_000 });

  // Finance raises the claim's invoice in PMO.
  await page.getByRole('button', { name: localized('Raise invoice', 'Terbitkan invoice'), exact: false }).filter({ hasNot: page.getByText('Billing summary') }).last().click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(/(?:A draft invoice is created in PMO|Draf invoice dibuat di PMO)/);
  await confirm.getByRole('button', { name: localized('Create invoice', 'Buat invoice') }).click();
  await expect(confirm).toBeHidden({ timeout: 15_000 });
  // A Draft bills no work yet.
  expect(await billedWork(page)).toBe('0');

  // The claim's author cannot approve; a second person — an Admin — reads it on the Approvals queue and does.
  await signIn(page, 'admin@acme.test');
  await page.goto('/approvals');
  const queue = page.getByRole('region', { name: localized('Customer invoices awaiting you', 'Invoice pelanggan yang menunggu Anda|Faktur pelanggan yang menunggu Anda') });
  const item = queue.getByRole('listitem').filter({ hasText: `${tag} Client` });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.getByRole('button', { name: new RegExp(`(?:Show invoice details for|Tampilkan detail faktur untuk|Tampilkan detail invoice untuk) ${tag} Client`, 'i') }).click();
  await expect(item.getByRole('list', { name: localized('Line items', 'Item faktur|Item invoice') })).toContainText('Route survey');
  await expect(item).toContainText(/(?:Total due|Total tagihan)\s*\S*\s?222[.,]000/i);
  await item.getByRole('button', { name: localized('Approve', 'Setujui') }).click();
  await page.getByRole('button', { name: localized('Approve invoice', 'Setujui invoice|Setujui faktur') }).click();
  await expect(item).toHaveCount(0, { timeout: 15_000 });

  // Billed work moves once, to the claim's 200,000.
  await signIn(page, 'finance@acme.test');
  expect(await billedWork(page)).toBe('200000');

  // Finance records the payment in PMO; billed work does not move again.
  await page.goto('/finance/receivables?view=payments');
  await page.getByRole('button', { name: localized('Receive payment', 'Terima pembayaran') }).click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^(?:Customer|Pelanggan)/, new RegExp(`${tag} Client`));
  await pickComboboxOption(form, page, /^(?:Sales Invoice|Faktur Penjualan|Invoice Penjualan)/, /INV-\d{10}/);
  await form.getByLabel(localized('Amount settled', 'Jumlah yang dilunasi')).fill('222000');
  await form.getByLabel(localized('Cash received', 'Kas diterima')).fill('222000');
  await form.getByRole('button', { name: localized('Record payment', 'Catat pembayaran') }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  await page.goto('/sales-invoices');
  const search = page.getByLabel(localized('Search sales invoices', 'Cari faktur penjualan|Cari invoice penjualan'));
  await search.fill(`${tag} Client`);
  await expect(page.getByRole('row').filter({ hasText: `${tag} Client` }).getByText(localizedExact('Paid', 'Dibayar'))).toBeVisible({ timeout: 15_000 });
  expect(await billedWork(page)).toBe('200000');
});
