// @e2e-isolation: self-isolated — owns a client, project, assessment, claim, its own step template and billing-stage list, and cleans them up.
/**
 * AC-CBS-015 — #2680, the one cross-stack journey for billing steps from a template. Finance saves a template whose first step is owned by
 * the Finance role, loads it onto the project, raises a claim, sees the step as a pointer in their needs-you list, completes it (the pointer
 * clears with no other write), completes the last step and raises the invoice. Goal oracle: the pointer appears while the step waits on
 * the role and is gone once it completes, and the invoice is created.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { userClient } from './support/stockFixture';
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
  if (!key) throw new Error('AC-CBS-015 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `AC-CBS-015 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-CBS-015 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12,
    tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`AC-CBS-015 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const line = await admin.from('boq_items').insert({
    org_id: ORG_ID, project_id: projectId, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50_000,
  }).select('id').single();
  if (line.error) throw new Error(`AC-CBS-015 fixture contract line: ${line.error.message}`);
  workOrderId = randomUUID();
  workOrderNumber = `WO-RET-${workOrderId.slice(0, 8)}`;
  const order = await admin.from('work_orders').insert({ id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${tag} Order`, status: 'Issued', wo_number: workOrderNumber, order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR' });
  if (order.error) throw new Error(`AC-CBS-015 fixture work order: ${order.error.message}`);
  const allocation = await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: line.data.id, quantity: 10 });
  if (allocation.error) throw new Error(`AC-CBS-015 fixture allocation: ${allocation.error.message}`);
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const entry = await admin.from('project_progress_entries').insert({ org_id: ORG_ID, project_id: projectId, month, pct_complete: 60 }).select('id').single();
  if (entry.error) throw new Error(`AC-CBS-015 fixture progress: ${entry.error.message}`);
  progressEntryId = entry.data.id;
  const quantity = await admin.from('progress_assessment_quantities').insert({ org_id: ORG_ID, entry_id: progressEntryId, boq_item_id: line.data.id, quantity_to_date: 6 });
  if (quantity.error) throw new Error(`AC-CBS-015 fixture progress quantity: ${quantity.error.message}`);
  documentId = randomUUID();
  const evidence = await admin.from('project_documents').insert({
    id: documentId, org_id: ORG_ID, project_id: projectId, category: 'Report', title: `${tag} progress report`, revision: 'A',
    status: 'Approved', file_path: `${ORG_ID}/${projectId}/${documentId}/report.pdf`,
  });
  if (evidence.error) throw new Error(`AC-CBS-015 fixture evidence: ${evidence.error.message}`);
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-CBS-015 cleanup ${step}: ${e.message}`); };
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
  fail('templates', (await admin.from('billing_step_templates').delete().like('name', `${tag}%`)).error);
  if (companyId) {
    fail('company', (await admin.from('companies').delete().eq('id', companyId)).error);
    companyId = '';
  }
});

test('AC-CBS-015 a template step owned by the Finance role points at Finance until it completes, and the invoice is raised', async ({ page }) => {
  const finance = await userClient('finance@acme.test');
  const saved = await finance.rpc('save_billing_step_template', { p_template: null, p_name: `${tag} template`, p_steps: [
    { name: 'Survey report', owner_role: 'Finance', target_days: 7, documents: [] },
    { name: 'Final check', owner_role: 'Admin', documents: [] },
  ] });
  if (saved.error) throw new Error(saved.error.message);
  const loaded = await finance.rpc('load_billing_step_template_onto_project', { p_project: projectId, p_template: saved.data as string });
  if (loaded.error) throw new Error(loaded.error.message);

  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${projectId}/contract`);
  await page.getByRole('button', { name: localized('New claim', 'Tagihan baru') }).click();
  const claimForm = page.getByRole('dialog');
  await claimForm.getByLabel(/^(Bills|Menagih)$/i).selectOption(workOrderId);
  await claimForm.getByLabel(/SURVEY/).fill('4');
  await claimForm.getByRole('button', { name: localized('Create claim', 'Buat tagihan') }).click();
  const evidenceForm = page.getByRole('dialog');
  await evidenceForm.getByLabel(localized('Evidence document', 'Dokumen bukti')).selectOption(documentId);
  await evidenceForm.getByRole('button', { name: localizedExact('Attach', 'Lampirkan') }).click();
  await expect(evidenceForm).toBeHidden({ timeout: 15_000 });
  await page.getByRole('button', { name: /Open Progress claim|Buka tagihan progres/i }).click();
  const claim = page.getByRole('dialog');
  await expect(claim).toContainText('0 of 2 complete');

  // The first step waits on the Finance role: it is a pointer in Finance's needs-you list.
  await page.keyboard.press('Escape');
  await page.goto('/');
  await expect(page.getByText(localized('billing step waiting on your role', 'langkah penagihan menunggu peran Anda'))).toBeVisible({ timeout: 15_000 });

  // Completing the step clears the pointer; nothing else is written for that.
  await page.goto(`/projects/${projectId}/contract`);
  await page.getByRole('button', { name: /Open Progress claim|Buka tagihan progres/i }).click();
  const claim2 = page.getByRole('dialog');
  await claim2.getByRole('button', { name: 'Complete Survey report' }).click();
  await expect(claim2).toContainText('1 of 2 complete', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.goto('/');
  await expect(page.getByText(localized('billing step waiting on your role', 'langkah penagihan menunggu peran Anda'))).toHaveCount(0, { timeout: 15_000 });

  await page.goto(`/projects/${projectId}/contract`);
  await page.getByRole('button', { name: /Open Progress claim|Buka tagihan progres/i }).click();
  const claim3 = page.getByRole('dialog');
  await claim3.getByRole('button', { name: 'Complete Final check' }).click();
  await expect(claim3).toContainText('2 of 2 complete', { timeout: 15_000 });
  await page.keyboard.press('Escape');

  const claims = page.getByRole('list', { name: localized('Claims & down payment', 'Klaim & uang muka|Tagihan & uang muka') });
  await claims.getByRole('button', { name: localized('Row actions', 'Tindakan baris') }).click();
  await page.getByRole('menuitem', { name: localized('Raise invoice', 'Terbitkan invoice') }).click();
  const confirm = page.getByRole('dialog', { name: localized("Create this claim's invoice\\?", 'Buat invoice tagihan ini\\?') });
  await confirm.getByRole('button', { name: localized('Create invoice', 'Buat invoice') }).click();
  await expect(confirm).toBeHidden({ timeout: 15_000 });
  const invoices = await admin!.from('sales_invoices').select('id').eq('project_id', projectId);
  expect(invoices.error).toBeNull();
  expect(invoices.data).toHaveLength(1);
});
