// @e2e-isolation: self-isolated — owns a client, project, assessment, claim, invoice and release, and cleans them up.
/** AC-RET-004: Finance reconciles progress against the claim and manages a retention release with proof. */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { orgToday } from './support/jobJourney';
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
let progressEntryId = '';
let workOrderId = '';
let workOrderNumber = '';
let tag = '';
const localized = (en: string, id: string) => new RegExp(`(?:${en}|${id})`, 'i');
const localizedExact = (en: string, id: string) => new RegExp(`^(?:${en}|${id})$`, 'i');

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-RET-004 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `NAR-045 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-RET-004 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12,
    tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`AC-RET-004 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const line = await admin.from('boq_items').insert({
    org_id: ORG_ID, project_id: projectId, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50_000,
  }).select('id').single();
  if (line.error) throw new Error(`AC-RET-004 fixture contract line: ${line.error.message}`);
  workOrderId = randomUUID();
  workOrderNumber = `WO-RET-${workOrderId.slice(0, 8)}`;
  const order = await admin.from('work_orders').insert({ id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${tag} Order`, status: 'Issued', wo_number: workOrderNumber, order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR' });
  if (order.error) throw new Error(`AC-RET-004 fixture work order: ${order.error.message}`);
  const allocation = await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: line.data.id, quantity: 10 });
  if (allocation.error) throw new Error(`AC-RET-004 fixture allocation: ${allocation.error.message}`);
  const month = `${orgToday().slice(0, 7)}-01`; // the progress entry is bucketed by the organisation's month
  const entry = await admin.from('project_progress_entries').insert({ org_id: ORG_ID, project_id: projectId, month, pct_complete: 60 }).select('id').single();
  if (entry.error) throw new Error(`AC-RET-004 fixture progress: ${entry.error.message}`);
  progressEntryId = entry.data.id;
  const quantity = await admin.from('progress_assessment_quantities').insert({ org_id: ORG_ID, entry_id: progressEntryId, boq_item_id: line.data.id, quantity_to_date: 6 });
  if (quantity.error) throw new Error(`AC-RET-004 fixture progress quantity: ${quantity.error.message}`);
  documentId = randomUUID();
  const evidence = await admin.from('project_documents').insert({
    id: documentId, org_id: ORG_ID, project_id: projectId, category: 'Report', title: `${tag} progress report`, revision: 'A',
    status: 'Approved', file_path: `${ORG_ID}/${projectId}/${documentId}/report.pdf`,
  });
  if (evidence.error) throw new Error(`AC-RET-004 fixture evidence: ${evidence.error.message}`);
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-RET-004 cleanup ${step}: ${e.message}`); };
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
    if (!/^[0-9a-f-]{36}$/.test(projectId)) throw new Error('Invalid fixture project id');
    execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], {
      input: `begin; set local session_replication_role = replica; delete from public.retention_releases where project_id = '${projectId}'; commit;`, encoding: 'utf8',
    });
    fail('invoices', (await admin.from('sales_invoices').delete().eq('project_id', projectId)).error);
    const claims = await admin.from('progress_claims').select('id').eq('project_id', projectId);
    fail('claim read', claims.error);
    const claimIds = (claims.data ?? []).map((r: { id: string }) => r.id);
    if (claimIds.length > 0) {
      fail('evidence', (await admin.from('progress_claim_evidence').delete().in('claim_id', claimIds)).error);
      fail('claims', (await admin.from('progress_claims').delete().in('id', claimIds)).error);
    }
    fail('documents', (await admin.from('project_documents').delete().eq('project_id', projectId)).error);
    if (workOrderId) {
      fail('order lines', (await admin.from('work_order_lines').delete().eq('work_order_id', workOrderId)).error);
      fail('order', (await admin.from('work_orders').delete().eq('id', workOrderId)).error);
      workOrderId = '';
    }
    if (progressEntryId) {
      fail('assessment quantities', (await admin.from('progress_assessment_quantities').delete().eq('entry_id', progressEntryId)).error);
      fail('assessment', (await admin.from('project_progress_entries').delete().eq('id', progressEntryId)).error);
      progressEntryId = '';
    }
    fail('contract lines', (await admin.from('boq_items').delete().eq('project_id', projectId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
    projectId = '';
  }
  if (companyId) {
    fail('company', (await admin.from('companies').delete().eq('id', companyId)).error);
    companyId = '';
  }
});

/** The project's "Billed to date" figure in the Contract tab's claims card (a bare number, as the card prints it). */
async function billedWork(page: Page): Promise<string> {
  await page.goto(`/projects/${projectId}/contract`);
  const details = page.getByText(localizedExact('Billing summary details', 'Rincian ringkasan penagihan'));
  await expect(details).toBeVisible({ timeout: 15_000 });
  await details.click();
  const figure = page.getByTestId('work-orders-billing-detail').locator('div')
    .filter({ has: page.getByText(localizedExact('Billed to date', 'Ditagih s.d. saat ini')) }).locator('dd').first();
  await expect(figure).toBeVisible({ timeout: 15_000 });
  return (await figure.innerText()).replace(/\D/g, '');
}

test('AC-RET-004 reconciliation follows a claim and Finance manages retention releases', async ({ page }, testInfo) => {
  // Finance makes the claim from the contract lines: 4 km of 10 → 200,000 excl. PPN.
  await signIn(page, 'finance@acme.test');
  expect(await billedWork(page)).toBe('0');
  await page.getByRole('button', { name: localizedExact('Billing terms', 'Ketentuan penagihan') }).click();
  const terms = page.getByRole('dialog', { name: localizedExact('Billing terms', 'Ketentuan penagihan') });
  await expect(terms.getByRole('button', { name: /Save billing terms|Simpan ketentuan penagihan/i })).toBeEnabled();
  await terms.getByRole('textbox', { name: /Invoice deadline \(day of month\)|Batas faktur/i }).fill('25');
  await terms.getByRole('textbox', { name: /Retention \(%\)|Retensi \(%\)/i }).fill('10');
  await terms.getByRole('button', { name: /Save billing terms|Simpan ketentuan penagihan/i }).click();
  await expect(terms).toBeHidden({ timeout: 15_000 });
  await page.getByRole('button', { name: localized('New claim', 'Tagihan baru') }).click();
  const claimForm = page.getByRole('dialog');
  await claimForm.getByLabel(/^(Bills|Menagih)$/i).selectOption(workOrderId);
  await claimForm.getByLabel(/SURVEY/).fill('4');
  await claimForm.getByRole('button', { name: localized('Create claim', 'Buat tagihan') }).click();

  // The next step is the evidence.
  const evidenceForm = page.getByRole('dialog');
  await evidenceForm.getByLabel(localized('Evidence document', 'Dokumen bukti')).selectOption(documentId);
  await evidenceForm.getByRole('button', { name: localizedExact('Attach', 'Lampirkan') }).click();
  await expect(evidenceForm).toBeHidden({ timeout: 15_000 });
  const reconciliation = page.getByRole('region', { name: /Billing reconciliation|Rekonsiliasi penagihan/i });
  const initialItem = reconciliation.getByRole('row').filter({ hasText: 'Route survey' });
  await expect(initialItem.getByRole('cell').nth(2)).toHaveText('4');
  await expect(initialItem.getByRole('cell').nth(3)).toHaveText('0');
  await page.getByRole('button', { name: /Open Progress claim|Buka tagihan progres/i }).click();
  const unbilledClaim = page.getByRole('dialog');
  await expect(unbilledClaim).toContainText(/Invoice deadline|Batas faktur/i);
  await expect(unbilledClaim).toContainText(/Retention held|Retensi ditahan/i);
  await unbilledClaim.getByRole('button', { name: /^(Close|Tutup)$/i }).click();

  // Finance creates the claim's invoice in PMO: a Draft, no ERP anywhere.
  const claims = page.getByRole('list', { name: localized('Claims & down payment', 'Klaim & uang muka|Tagihan & uang muka') });
  await claims.getByRole('button', { name: localized('Row actions', 'Tindakan baris') }).click();
  await page.getByRole('menuitem', { name: localized('Raise invoice', 'Terbitkan invoice') }).click();
  const confirm = page.getByRole('dialog', { name: localized("Create this claim's invoice\\?", 'Buat invoice tagihan ini\\?') });
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

  await page.goto(`/projects/${projectId}/contract`);
  await expect(reconciliation).toBeVisible();
  const recItem = reconciliation.getByRole('row').filter({ hasText: 'Route survey' });
  const cells = recItem.getByRole('cell');
  await expect(cells.nth(1)).toHaveText('6');
  await expect(cells.nth(2)).toHaveText('4');
  await expect(cells.nth(3)).toHaveText('4');
  await expect(cells.nth(4)).toContainText(/200[,.]000/);
  await reconciliation.screenshot({ path: testInfo.outputPath('reconciliation.png') });
  await page.getByRole('button', { name: /Open Progress claim|Buka tagihan progres/i }).click();
  const drawer = page.getByRole('dialog');
  const retention = drawer.getByRole('region', { name: /Retention releases|Pelepasan retensi/i });
  await expect(retention).toBeVisible();
  await retention.getByRole('textbox', { name: /Amount|Jumlah/i }).fill('5000');
  await retention.getByRole('button', { name: /Schedule release|Jadwalkan pelepasan/i }).click();
  await expect(retention).toContainText(/5[,.]000/);
  await retention.getByRole('button', { name: /Cancel release|Batalkan pelepasan/i }).click();
  await page.getByRole('button', { name: /Confirm cancellation|Konfirmasi pembatalan/i }).click();
  await expect(retention).toContainText(/No releases scheduled|Belum ada pelepasan terjadwal/i);
  await retention.getByRole('textbox', { name: /Amount|Jumlah/i }).fill('5000');
  await retention.getByRole('button', { name: /Schedule release|Jadwalkan pelepasan/i }).click();
  await retention.getByLabel(/Reference \(optional\)|Referensi \(opsional\)/i).fill('E2E-RELEASE');
  await retention.getByLabel(/Proof document|Dokumen bukti/i).selectOption(documentId);
  await retention.getByRole('button', { name: /Record release|Catat pelepasan/i }).click();
  await expect(page.getByRole('button', { name: /Confirm release|Konfirmasi pelepasan/i })).toBeVisible();
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))); });
  await page.screenshot({ path: testInfo.outputPath('confirm-release.png') });
  await page.getByRole('button', { name: /Confirm release|Konfirmasi pelepasan/i }).click();
  await expect(retention).toContainText(/Released|Dilepas/i);
  await expect(drawer.getByText(/Retention held|Retensi ditahan/i)).toContainText(/15[,.]000/);
  await expect(retention.getByRole('link', { name: `${tag} progress report` })).toBeVisible();
  await retention.screenshot({ path: testInfo.outputPath('retention.png') });
  await page.goto(`/projects/${projectId}/contract?open=${workOrderId}&openType=workOrder`);
  const orderDrawer = page.getByRole('dialog');
  const orderReconciliation = orderDrawer.getByRole('region', { name: /Billing reconciliation|Rekonsiliasi penagihan/i });
  const orderRow = orderReconciliation.getByRole('row').filter({ hasText: 'Route survey' });
  await expect(orderRow).toBeVisible();
  const orderCells = orderRow.getByRole('cell');
  await expect(orderCells.nth(1)).toHaveText('6');
  await expect(orderCells.nth(2)).toHaveText('4');
  await expect(orderCells.nth(3)).toHaveText('4');
  await orderReconciliation.screenshot({ path: testInfo.outputPath('work-order-reconciliation.png') });
});
