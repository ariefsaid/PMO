// @e2e-isolation: serial — AC-EXP-140 (#775 phase B): a field claim settled against an advance reaches the ERPNext
// ledger through the sweep, exactly once, tagged to the project. Goal oracle = the ERP documents and the GL mirror.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { benchGet, runSweep, ORG_ID, SEED_PASSWORD } from './_tspHelpers';
import {
  CASH_ACCOUNT, EMPLOYEE_ADVANCE, EMPLOYEE_PAYABLE, ENGINEER_EMAIL, FINANCE_EMAIL, PM_EMAIL, TRAVEL_ACCOUNT,
  cleanupExp, createDraft, seedExp, type ExpSeed,
} from './_expHelpers';
import { expensePostingKey } from '../../src/lib/adapterSeam/erpnext/expensePostingKey';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const READY = !!FUNCTIONS_URL && !!SUPABASE_URL && !!ANON_KEY && !!SERVICE_KEY && !!process.env.ERPNEXT_BENCH_API_KEY;
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-EXP-140: the served lane is up (SUPABASE_FUNCTIONS_URL set) but SUPABASE_URL / anon / service keys / ERPNEXT_BENCH_API_KEY are missing — never a silent skip');
}
test.skip(!READY, 'AC-EXP-140: served-fn lane + ERPNext bench not configured — run via scripts/serve-functions.sh against the bench');

let admin: SupabaseClient;
let seed: ExpSeed | undefined;
const claimIds: string[] = [];

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  seed = await seedExp(admin, `${Date.now()}`);
});
test.afterAll(async () => {
  if (seed) await cleanupExp(admin, seed, claimIds);
});

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`sign-in ${email} failed: ${error.message}`);
  return client;
}

type Mirror = { posting: string; push_state: string; erp_name: string | null; push_error: string | null };
const intents = async (claimId: string): Promise<Mirror[]> =>
  ((await admin.from('expense_posting_erp_mirror').select('posting, push_state, erp_name, push_error')
    .eq('claim_id', claimId).order('created_at').order('posting')).data ?? []) as Mirror[];

test('AC-EXP-140 a claim settled against an advance posts once to ERPNext, tagged to the project', async () => {
  test.setTimeout(180_000);
  const s = seed as ExpSeed;
  const engineer = await signIn(ENGINEER_EMAIL);
  const pm = await signIn(PM_EMAIL);
  const finance = await signIn(FINANCE_EMAIL);
  const move = async (client: SupabaseClient, id: string, to: string, ref?: string) => {
    const { error } = await client.rpc('transition_expense_claim', { p_id: id, p_to: to, ...(ref ? { p_payment_reference: ref } : {}) });
    expect(error, `${to} ${id}`).toBeNull();
  };

  // ── the Engineer takes a 50,000 advance; the PM approves; Finance pays it
  const advanceId = crypto.randomUUID();
  claimIds.push(advanceId);
  await createDraft(admin, { id: advanceId, kind: 'advance', title: 'Site trip float', projectId: s.projectId, amount: 50000 });
  await move(engineer, advanceId, 'Submitted');
  await move(pm, advanceId, 'Approved');
  await move(finance, advanceId, 'Paid', 'TRF-ADV-1');

  // ── a 150,000 Travel claim that settles against it; the PM approves; Finance pays (50,000 applied, 100,000 cash)
  const claimId = crypto.randomUUID();
  claimIds.unshift(claimId);
  await createDraft(admin, { id: claimId, kind: 'claim', title: 'Site trip', projectId: s.projectId, advanceId });
  expect((await engineer.from('expense_claim_lines').insert({
    claim_id: claimId, expense_date: '2026-10-06', expense_type: 'Travel', description: 'Return bus fare', amount: 150000,
  })).error).toBeNull();
  await move(engineer, claimId, 'Submitted');
  await move(pm, claimId, 'Approved');
  await move(finance, claimId, 'Paid', 'TRF-EXP-1');

  // ── the sweep is the only originator (ADR-0081)
  expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);

  const claimIntents = await intents(claimId);
  expect(claimIntents.map((m) => `${m.posting}:${m.push_state}`).sort(), JSON.stringify(claimIntents))
    .toEqual(['approval:pushed', 'claim-payment:pushed', 'settlement:pushed']);
  const advanceIntents = await intents(advanceId);
  expect(advanceIntents.map((m) => `${m.posting}:${m.push_state}`), JSON.stringify(advanceIntents)).toEqual(['advance-payment:pushed']);
  const byPosting = Object.fromEntries(claimIntents.map((m) => [m.posting, m.erp_name as string]));

  // ── the approval Journal Entry: keyed, project on the expense row, Employee credit
  const { data: claim } = await admin.from('expense_claims').select('approved_at, currency').eq('id', claimId).single();
  expect((claim as { currency: string }).currency).toBe('IDR');
  const approval = await benchGet<Record<string, unknown>>(`/api/resource/Journal%20Entry/${encodeURIComponent(byPosting.approval)}`);
  expect(approval.docstatus).toBe(1);
  expect(approval.user_remark).toBe(expensePostingKey('approval', claimId, (claim as { approved_at: string }).approved_at));
  const approvalRows = approval.accounts as Array<Record<string, unknown>>;
  expect(approvalRows.find((r) => r.account === TRAVEL_ACCOUNT)).toMatchObject({ debit_in_account_currency: 150000, project: s.erpProject });
  expect(approvalRows.find((r) => r.account === EMPLOYEE_PAYABLE)).toMatchObject({ credit_in_account_currency: 150000, party_type: 'Employee', party: s.employee });

  // ── the cash Payment Entry: explicit accounts, references the approval
  const payment = await benchGet<Record<string, unknown>>(`/api/resource/Payment%20Entry/${encodeURIComponent(byPosting['claim-payment'])}`);
  expect(payment).toMatchObject({ docstatus: 1, payment_type: 'Pay', party_type: 'Employee', party: s.employee,
    paid_from: CASH_ACCOUNT, paid_to: EMPLOYEE_PAYABLE, paid_amount: 100000 });
  expect((payment.references as Array<Record<string, unknown>>)[0]).toMatchObject({ reference_doctype: 'Journal Entry', reference_name: byPosting.approval });

  // ── the settlement Journal Entry: payable (referencing the approval) against the advance account
  const settlement = await benchGet<Record<string, unknown>>(`/api/resource/Journal%20Entry/${encodeURIComponent(byPosting.settlement)}`);
  const settlementRows = settlement.accounts as Array<Record<string, unknown>>;
  expect(settlementRows.find((r) => r.account === EMPLOYEE_PAYABLE)).toMatchObject({ debit_in_account_currency: 50000, reference_name: byPosting.approval });
  expect(settlementRows.find((r) => r.account === EMPLOYEE_ADVANCE)).toMatchObject({ credit_in_account_currency: 50000, party: s.employee });

  // ── the advance payout went to the advance account
  const advancePe = await benchGet<Record<string, unknown>>(`/api/resource/Payment%20Entry/${encodeURIComponent(advanceIntents[0].erp_name as string)}`);
  expect(advancePe).toMatchObject({ docstatus: 1, paid_to: EMPLOYEE_ADVANCE, paid_amount: 50000 });

  // ── a second tick posts nothing new, and feeds the GL mirror (field cost reaches project actuals)
  const tick2 = await runSweep(FUNCTIONS_URL);
  expect(tick2.status).toBe(200);
  const jeFilter = encodeURIComponent(JSON.stringify([['user_remark', 'like', `%${claimId}%`]]));
  expect(await benchGet<unknown[]>(`/api/resource/Journal%20Entry?filters=${jeFilter}&limit_page_length=0`)).toHaveLength(2);
  const peFilter = encodeURIComponent(JSON.stringify([['reference_no', 'like', `%${claimId}%`]]));
  expect(await benchGet<unknown[]>(`/api/resource/Payment%20Entry?filters=${peFilter}&limit_page_length=0`)).toHaveLength(1);
  const { data: gl } = await admin.from('erp_gl_entry_mirror').select('account, project, debit')
    .eq('org_id', ORG_ID).eq('voucher_no', byPosting.approval).eq('account', TRAVEL_ACCOUNT).eq('is_cancelled', false);
  expect(gl, `second sweep tick: ${JSON.stringify(tick2.body)}`).toEqual([{ account: TRAVEL_ACCOUNT, project: s.erpProject, debit: 150000 }]);
});
