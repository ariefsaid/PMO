// @e2e-isolation: serial — Finance saves the organisation-wide billing plan setting; afterEach restores the row it found (or deletes it) and archives its project.
/**
 * AC-MBP-018 — #2682, the one cross-stack journey for the monthly billing plan. Finance opens the plan from Receivables, sets a monthly
 * target, picks a candidate (work the client accepted and nobody has claimed) and sees the picked total against the target. Goal oracle:
 * the candidate is on the plan with its value, the total reflects the pick against the target, and nothing was raised: no claim and
 * no invoice exists for the project afterwards.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let companyId = '';
let workOrderId = '';
let acceptanceId = '';
let boqId = '';
let priorSettings: Record<string, unknown> | null = null;
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-MBP-018 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  admin = db;
  const must = (step: string, r: { data: unknown; error: { message: string } | null }): { id: string } => {
    if (r.error || r.data === null) throw new Error(`AC-MBP-018 fixture ${step}: ${r.error?.message ?? 'no row'}`);
    return r.data as { id: string };
  };
  tag = `AC-MBP-018 ${Date.now()}`;
  companyId = must('company', await db.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single()).id;
  projectId = must('project', await db.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 100_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single()).id;
  const finance = must('finance user', await db.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
  boqId = must('boq', await db.from('boq_items').insert({
    org_id: ORG_ID, project_id: projectId, item_code: 'MBP-1', description: `${tag} item`, unit: 'm', quantity: 100, rate: 1000, earning_basis: 'unit_rate', line_no: 1,
  }).select('id').single()).id;
  workOrderId = must('work order', await db.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${tag} order`, status: 'Issued', order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
  }).select('id').single()).id;
  must('order line', await db.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boqId, quantity: 20 }).select('work_order_id').single());
  acceptanceId = must('acceptance', await db.from('work_order_acceptances').insert({
    org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, acceptance_date: new Date().toISOString().slice(0, 10), is_final: false, status: 'Confirmed',
    prepared_by: finance.id, confirmed_by: finance.id, confirmed_at: new Date().toISOString(), confirm_basis: 'standard',
  }).select('id').single()).id;
  must('acceptance line', await db.from('work_order_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: boqId, quantity: 12 }).select('acceptance_id').single());
  const prior = await db.from('org_billing_plan_settings').select('*').eq('org_id', ORG_ID).maybeSingle();
  priorSettings = prior.data ?? null;
  await db.from('org_billing_plan_settings').delete().eq('org_id', ORG_ID);
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-MBP-018 cleanup ${step}: ${e.message}`); };
  fail('month targets', (await admin.from('billing_plan_month_targets').delete().eq('org_id', ORG_ID)).error);
  fail('settings', (await admin.from('org_billing_plan_settings').delete().eq('org_id', ORG_ID)).error);
  if (priorSettings) fail('restore settings', (await admin.from('org_billing_plan_settings').insert(priorSettings)).error);
  // A confirmed acceptance is permanent by design (migration 0337), so the fixture cannot be deleted: the project is archived instead,
  // which takes its work off every plan. The names carry a unique tag.
  if (projectId) fail('archive project', (await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId)).error);
});

test('AC-MBP-018 Finance sets a target, picks accepted-not-claimed work and sees the total against it, with nothing raised', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/finance/receivables');
  await page.getByTestId('receivables-billing-plan-link').click();
  await expect(page).toHaveURL(/\/finance\/billing-plan/);
  await expect(page.getByTestId('billing-plan-statement')).toContainText(/Candidates only|Hanya kandidat/);

  // Narrow to this project (the organisation may hold other candidates), then set the target.
  await page.goto(`/finance/billing-plan?project=${projectId}`);
  await expect(page.getByTestId('billing-plan-target')).toContainText(/No target set|Target belum ditetapkan/, { timeout: 15_000 });
  await page.getByTestId('billing-plan-settings-button').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Default monthly target|Target bulanan bawaan/).fill('10000');
  await dialog.getByLabel(/^Currency|^Mata uang/).fill('IDR');
  await dialog.getByRole('button', { name: /Save settings|Simpan pengaturan/ }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('billing-plan-target')).toContainText(/10[.,]000/);

  // 12 accepted, none claimed: 12 x 1,000 = 12,000, above the 10,000 target.
  const lineRow = page.getByTestId('billing-plan-line').filter({ hasText: tag });
  await expect(lineRow).toContainText(/12[.,]000/);
  await lineRow.getByRole('checkbox').click();
  await expect(page.getByTestId('billing-plan-picked')).toContainText(/12[.,]000/);
  await expect(page.getByTestId('billing-plan-remaining')).toContainText(/2[.,]000/);
  await expect(page.getByTestId('billing-plan-summary')).toContainText(/Above target by|Melebihi target/);

  // Nothing was raised.
  const claims = await admin!.from('progress_claims').select('id', { count: 'exact', head: true }).eq('project_id', projectId);
  const invoices = await admin!.from('sales_invoices').select('id', { count: 'exact', head: true }).eq('project_id', projectId);
  expect(claims.count).toBe(0);
  expect(invoices.count).toBe(0);
});
