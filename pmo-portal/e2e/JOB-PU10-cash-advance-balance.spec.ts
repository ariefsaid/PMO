// @e2e-isolation: self-isolated — creates its own uniquely-named project, budget, float, plan and claims each run and deletes them afterwards; the org procurement limit is inserted only when absent and removed only if this run inserted it. Shared-row dependency: the org-wide imprest settings row and the org senior approver set are read, not owned.
/**
 * JOB-PU10 — site finance plans a cash advance of a set amount, records two purchases against it, and the float page shows the balance:
 * the advance minus the purchases (5,000,000 − 500,000 − 300,000 = 4,200,000), with the two receipts still waiting to be topped up.
 * Partly landed: floats, plans and claims exist; planning "how much cash advance is needed per month" before the advance exists is the plan step used here.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, SEED_PASSWORD } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2'; // project manager and float custodian
const EXEC_ID = '00000000-0000-0000-0000-0000000000a1'; // the project's named approver
const ADMIN_ID = '00000000-0000-0000-0000-0000000000a5';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? VITE_ENV.VITE_SUPABASE_ANON_KEY ?? '';

test.setTimeout(240_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let floatId = '';
let limitInserted = false;
let tag = '';

/** A client signed in as a seed user, so setup goes through the same RPCs and RLS the app does. */
async function asUser(email: string): Promise<SupabaseClient> {
  if (!ANON_KEY) throw new Error('JOB-PU10 needs VITE_SUPABASE_ANON_KEY — run it via scripts/e2e-local.sh');
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`JOB-PU10 sign in ${email}: ${error.message}`);
  return client;
}
const ok = <T>(step: string, r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(`JOB-PU10 ${step}: ${r.error.message}`);
  return r.data;
};
/** `ok` for a read or write that must return a row. */
const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  const data = ok(step, r);
  if (data === null || data === undefined) throw new Error(`JOB-PU10 ${step}: no row returned`);
  return data as NonNullable<D>;
};
const rpc = async (c: SupabaseClient, step: string, fn: string, args: Record<string, unknown>) => ok(step, await c.rpc(fn, args));

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('JOB-PU10 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `JOB-PU10 ${Date.now()}`;

  const project = need('project', await admin.from('projects')
    .insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single());
  projectId = project.id;
  const version = need('budget version', await admin.from('budget_versions')
    .insert({ org_id: ORG_ID, project_id: projectId, name: tag, version: 1, status: 'Draft' }).select('id').single());
  ok('budget line', await admin.from('budget_line_items').insert({ org_id: ORG_ID, budget_version_id: version.id, category: 'Vehicle', budgeted_amount: 20_000_000 }));
  ok('budget activate', await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.id));
  ok('approver', await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: EXEC_ID }));
  const existing = ok('limit read', await admin.from('org_imprest_settings').select('org_id').eq('org_id', ORG_ID).maybeSingle());
  if (!existing) {
    ok('limit', await admin.from('org_imprest_settings').insert({ org_id: ORG_ID, procurement_limit: 5_000_000, updated_by: ADMIN_ID }));
    limitInserted = true;
  }

  // Float: Finance establishes it, the Admin (senior route: no set is configured) decides the amount, the custodian asks for
  // funding, Finance approves, Admin pays.
  const adminUser = await asUser('admin@acme.test');
  const finance = await asUser('finance@acme.test');
  const pm = await asUser('pm@acme.test');
  floatId = (await rpc(finance, 'establish float', 'establish_imprest_float', { p_project: projectId, p_custodian: PM_ID, p_amount: 5_000_000 })) as string;
  const change = need('float change', await admin.from('imprest_float_changes').select('id').eq('float_id', floatId).single());
  await rpc(adminUser, 'decide float amount', 'decide_imprest_float_change', { p_change: change.id, p_approve: true, p_notes: null });
  const funding = (await rpc(pm, 'request funding', 'request_imprest_replenishment', { p_float: floatId, p_kind: 'funding' })) as string;
  await rpc(finance, 'approve funding', 'transition_imprest_replenishment', { p_id: funding, p_to: 'Approved', p_notes: null, p_payment_reference: null });
  await rpc(adminUser, 'pay funding', 'transition_imprest_replenishment', { p_id: funding, p_to: 'Paid', p_notes: null, p_payment_reference: `FUND-${tag}` });

  // Plan for the org's current month (read from the position, never recomputed here): the custodian drafts and submits, the Executive approves.
  const position = need('position', await pm.rpc('get_imprest_position', { p_float: floatId })) as Array<{ month: string }>;
  const month = position[0].month;
  const planId = need('plan', await pm.from('imprest_plans').insert({ float_id: floatId, month }).select('id').single()).id;
  ok('plan line', await pm.from('imprest_plan_lines').insert({ plan_id: planId, budget_category: 'Vehicle', planned_amount: 2_000_000 }));
  await rpc(pm, 'submit plan', 'transition_imprest_plan', { p_id: planId, p_to: 'Submitted', p_notes: null });
  const exec = await asUser('exec@acme.test');
  await rpc(exec, 'approve plan', 'transition_imprest_plan', { p_id: planId, p_to: 'Approved', p_notes: null });

  // Two purchases against the advance: the Engineer files each, the Executive approves, the custodian pays.
  const engineer = await asUser('engineer@acme.test');
  for (const [what, amount] of [['diesel', 500_000], ['welding rods', 300_000]] as const) {
    const claim = need('claim', await engineer.from('expense_claims')
      .insert({ kind: 'claim', title: `${tag} ${what}`, project_id: projectId, budget_category: 'Vehicle', imprest_float_id: floatId }).select('id').single());
    ok('claim line', await engineer.from('expense_claim_lines')
      .insert({ claim_id: claim.id, expense_date: new Date().toISOString().slice(0, 10), expense_type: 'Travel', description: what, amount }));
    ok('claim receipt', await engineer.from('expense_claim_files').insert({ claim_id: claim.id, title: 'receipt', file_path: `${ORG_ID}/${claim.id}/${crypto.randomUUID()}/receipt.png` }));
    await rpc(engineer, 'submit claim', 'transition_expense_claim', { p_id: claim.id, p_to: 'Submitted', p_notes: null, p_payment_reference: null });
    await rpc(exec, 'approve claim', 'transition_expense_claim', { p_id: claim.id, p_to: 'Approved', p_notes: null, p_payment_reference: null });
    await rpc(pm, 'pay claim', 'transition_expense_claim', { p_id: claim.id, p_to: 'Paid', p_notes: null, p_payment_reference: `PAY-${tag}-${what}` });
  }
});

test.afterEach(async () => {
  if (!admin || !projectId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-PU10 cleanup ${step}: ${e.message}`); };
  fail('claims', (await admin.from('expense_claims').delete().eq('project_id', projectId)).error);
  if (floatId) {
    fail('replenishments', (await admin.from('imprest_replenishments').delete().eq('float_id', floatId)).error);
    fail('plans', (await admin.from('imprest_plans').delete().eq('float_id', floatId)).error);
    fail('changes', (await admin.from('imprest_float_changes').delete().eq('float_id', floatId)).error);
    fail('float', (await admin.from('imprest_floats').delete().eq('id', floatId)).error);
  }
  fail('approvers', (await admin.from('spend_approvers').delete().eq('project_id', projectId)).error);
  fail('versions', (await admin.from('budget_versions').delete().eq('project_id', projectId)).error);
  fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  if (limitInserted) fail('limit', (await admin.from('org_imprest_settings').delete().eq('org_id', ORG_ID)).error);
  projectId = ''; floatId = ''; limitInserted = false;
});


test('JOB-PU10 the float reads the advance minus the two purchases recorded against it', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto(`/imprest/${floatId}`);
  await expect(page.getByTestId('figure-receipts')).toContainText(/800[.,]000/, { timeout: 20_000 });
  await expect(page.getByTestId('figure-cash')).toContainText(/4[.,]200[.,]000/);
  await expect(page.locator('li', { hasText: `${tag} diesel` })).toBeVisible();
  await expect(page.locator('li', { hasText: `${tag} welding rods` })).toBeVisible();
});
