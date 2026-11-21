// @e2e-isolation: self-isolated — owns a client, project, assessment, claim and its own billing-stage list, and cleans them up.
/**
 * AC-BSX-013 — #2592, the one cross-stack journey for an optional billing stage. A project's list has an optional middle stage; Finance completes the
 * first, marks the optional one not needed with a reason, completes the last, and raises the claim's invoice. Goal oracle: the invoice is created
 * and the claim's trace still shows the stage as not needed, with its reason.
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
  if (!key) throw new Error('AC-BSX-013 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `AC-BSX-013 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-BSX-013 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12,
    tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`AC-BSX-013 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const line = await admin.from('boq_items').insert({
    org_id: ORG_ID, project_id: projectId, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50_000,
  }).select('id').single();
  if (line.error) throw new Error(`AC-BSX-013 fixture contract line: ${line.error.message}`);
  workOrderId = randomUUID();
  workOrderNumber = `WO-RET-${workOrderId.slice(0, 8)}`;
  const order = await admin.from('work_orders').insert({ id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${tag} Order`, status: 'Issued', wo_number: workOrderNumber, order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR' });
  if (order.error) throw new Error(`AC-BSX-013 fixture work order: ${order.error.message}`);
  const allocation = await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: line.data.id, quantity: 10 });
  if (allocation.error) throw new Error(`AC-BSX-013 fixture allocation: ${allocation.error.message}`);
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const entry = await admin.from('project_progress_entries').insert({ org_id: ORG_ID, project_id: projectId, month, pct_complete: 60 }).select('id').single();
  if (entry.error) throw new Error(`AC-BSX-013 fixture progress: ${entry.error.message}`);
  progressEntryId = entry.data.id;
  const quantity = await admin.from('progress_assessment_quantities').insert({ org_id: ORG_ID, entry_id: progressEntryId, boq_item_id: line.data.id, quantity_to_date: 6 });
  if (quantity.error) throw new Error(`AC-BSX-013 fixture progress quantity: ${quantity.error.message}`);
  documentId = randomUUID();
  const evidence = await admin.from('project_documents').insert({
    id: documentId, org_id: ORG_ID, project_id: projectId, category: 'Report', title: `${tag} progress report`, revision: 'A',
    status: 'Approved', file_path: `${ORG_ID}/${projectId}/${documentId}/report.pdf`,
  });
  if (evidence.error) throw new Error(`AC-BSX-013 fixture evidence: ${evidence.error.message}`);
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-BSX-013 cleanup ${step}: ${e.message}`); };
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

test('AC-BSX-013 an optional stage is marked not needed with a reason, and the claim\'s invoice is raised', async ({ page }) => {
  const finance = await userClient('finance@acme.test');
  const set = await finance.rpc('set_billing_stage_template', { p_project: projectId, p_stages: [
    { name: 'Survey report', client_side: false, target_days: 7, documents: [] },
    { name: 'Peer review', client_side: false, target_days: 3, optional: true, documents: [] },
    { name: 'Final check', client_side: false, documents: [] },
  ] });
  if (set.error) throw new Error(set.error.message);

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
  await expect(claim).toContainText('0 of 3 complete');

  await claim.getByRole('button', { name: 'Complete Survey report' }).click();
  await expect(claim).toContainText('1 of 3 complete', { timeout: 15_000 });

  // The optional stage is current: Finance marks it not needed and must give a reason.
  await claim.getByRole('button', { name: 'Mark Peer review as not needed' }).click();
  const reasonDialog = page.getByRole('dialog').filter({ hasText: 'Mark Peer review as not needed' }).last();
  await reasonDialog.getByRole('textbox', { name: 'Reason' }).fill('Covered by the client\'s own review');
  await reasonDialog.getByRole('button', { name: 'Mark not needed' }).click();
  await expect(claim).toContainText('2 of 3 complete', { timeout: 15_000 });
  await expect(claim).toContainText("Reason: Covered by the client's own review");

  await claim.getByRole('button', { name: 'Complete Final check' }).click();
  await expect(claim).toContainText('3 of 3 complete', { timeout: 15_000 });
  await page.keyboard.press('Escape');

  // Every stage is complete or not needed: the invoice can be raised.
  const claims = page.getByRole('list', { name: localized('Claims & down payment', 'Klaim & uang muka|Tagihan & uang muka') });
  await claims.getByRole('button', { name: localized('Row actions', 'Tindakan baris') }).click();
  await page.getByRole('menuitem', { name: localized('Raise invoice', 'Terbitkan invoice') }).click();
  const confirm = page.getByRole('dialog', { name: localized("Create this claim's invoice\\?", 'Buat invoice tagihan ini\\?') });
  await confirm.getByRole('button', { name: localized('Create invoice', 'Buat invoice') }).click();
  await expect(confirm).toBeHidden({ timeout: 15_000 });
  const invoices = await admin!.from('sales_invoices').select('id').eq('project_id', projectId);
  expect(invoices.error).toBeNull();
  expect(invoices.data).toHaveLength(1);

  // The claim's trace keeps the skip and its reason.
  const trace = await admin!.from('claim_billing_stages').select('name,skipped_on,skipped_reason').eq('project_id', projectId).eq('position', 2).single();
  expect(trace.data?.skipped_on).not.toBeNull();
  expect(trace.data?.skipped_reason).toBe("Covered by the client's own review");
});
