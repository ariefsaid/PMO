# Plan part 6 — #775 phase B: enablement, served journey, pre-enable checklist (Tasks C0–C9)

Part of [`2026-10-07-expense-claims-phase-b.md`](2026-10-07-expense-claims-phase-b.md). Conventions: §1.8 there.

This part switches the feature on (an Admin can employ `expenses`). The cancel path itself is already built and
unit-proven (parts 2–4: the `approval-cancel` intent, the resolver's cancel branch, AC-EXP-127); what this part adds
is the switch that makes any of it reachable — so it lands only once a cancel cannot leave the GL mirror wrong.

---

### C0 — Precondition: #901 is on `dev` (spec §10.7)

```bash
gh issue view 901 --json state -q .state            # must print CLOSED
git fetch origin dev && git log origin/dev --oneline --grep '#901' | head -3   # must list the fix commit
grep -n "is_cancelled" pmo-portal/src/lib/adapterSeam/erpnext/ledgerFetch.ts
```

Expect: CLOSED, a fix commit, and `ledgerFetch.ts` no longer excluding `is_cancelled = 1` rows from the incremental
GL fetch (the #901 fix shape: fetch by `modified` and upsert `is_cancelled`). **If any of the three fails, stop here
and report to the Director** — parts 2–5 may merge without this part; they are inert.

### C1 — RED: `expenses` is employable (AC-EXP-128, FR-EXP-118)

Append to `supabase/functions/external-set-company/setup.test.ts`:

```ts
Deno.test("AC-EXP-128 an Admin employs the expenses domain after its read probes pass", async () => {
  const result = await withFetchMock([
    ...base(),
    { label: "erp read probes", host: "erp.example.test", method: "GET", pathname: /^\/api\/resource\//,
      response: () => jsonResponse({ data: [] }) },
    supabaseRpc("admin_change_domain_ownership", () => jsonResponse(null)),
  ], async ({ calls }) => {
    const res = await handleSetCompanyRequest(await request({ tier: "erpnext", setupAction: "employ-domain", domain: "expenses" }));
    return { status: res.status, calls };
  });
  assertEquals(result.status, 200);
  assertEquals((rpcCall(result.calls, "admin_change_domain_ownership")[0].bodyJson as Record<string, unknown>).p_domain, "expenses");
  const probed = result.calls.filter((c) => c.url.host === "erp.example.test").map((c) => decodeURIComponent(c.url.pathname));
  for (const doctype of ["Journal Entry", "Payment Entry", "Employee"]) {
    assertEquals(probed.some((p) => p.includes(`/api/resource/${doctype}`)), true, `${doctype} was not probed`);
  }
});
```

Verify RED: `cd supabase/functions/external-set-company && deno test setup.test.ts --config deno.json --allow-env --allow-net --allow-read`
→ the new test fails with 400 (`Choose a supported ERP domain`).

### C2 — GREEN: the switch (FR-EXP-118, DD-EXP-22)

1. `supabase/functions/external-set-company/setup.ts`, `employErpDomain`:
   `!["companies", "procurement", "revenue", "timesheets"].includes(body.domain)` →
   `!["companies", "procurement", "revenue", "timesheets", "expenses"].includes(body.domain)`.
   (`sweepKindsForOrg(['expenses'])` already yields Journal Entry, Payment Entry and Employee — part 3 S5.)
2. `pmo-portal/src/components/integrations/ErpSetupChecklist.tsx`:
   `const ERP_DOMAINS = ['companies', 'procurement', 'revenue', 'timesheets'];` →
   `const ERP_DOMAINS = ['companies', 'procurement', 'revenue', 'timesheets', 'expenses'];` and in `domainNames` add
   `expenses: t('integrations.erpSetup.domainNames.expenses', 'Expenses'),`.
3. `pmo-portal/public/locales/en/common.json` → `integrations.erpSetup.domainNames.expenses`: `"Expenses"`;
   `pmo-portal/public/locales/id/common.json` → `"Biaya"`.
4. `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` — after the test
   `'Admin confirms a domain assignment and can run the existing party onboarding action'` add:

```tsx
  it('AC-EXP-128 Admin can employ the expenses domain', async () => {
    const erpBinding={...mockBinding,external_tier:'erpnext' as const,config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    wrapWithRole('Admin',<IntegrationsView/>);
    fireEvent.click(await screen.findByRole('button',{name:'Employ ERP domains'}));
    fireEvent.change(screen.getByRole('combobox', {name:'Domain'}),{target:{value:'expenses'}});
    fireEvent.click(screen.getByRole('button',{name:'Employ domain'}));
    await waitFor(()=>expect(erpSetup.employErpDomain).toHaveBeenCalledWith('expenses'));
  });
```

Verify GREEN: the C1 command → green;
`cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/components/integrations/IntegrationsView.test.tsx` → green.

### C3 — e2e seed helper

Create `pmo-portal/e2e/serial/_expHelpers.ts`:

```ts
// @e2e-isolation: serial — shared seed for the #775 phase B served journey (AC-EXP-140).
// Flips org-global state of the shared seed org: its ERPNext binding, the `expenses` ownership row, its default
// currency (set to IDR, restored after) and the Engineer's confirmed ERP Employee link.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { benchGet, benchPost, createErpProject, ERP_COMPANY, ERPNEXT_SITE_URL, ORG_ID, SEED_PASSWORD } from './_tspHelpers';

export const ENGINEER_EMAIL = 'engineer@acme.test';
export const PM_EMAIL = 'pm@acme.test';
export const FINANCE_EMAIL = 'finance@acme.test';
export const EMPLOYEE_PAYABLE = 'PMO E2E Employee Payable - PSC';
export const EMPLOYEE_ADVANCE = 'Employee Advances - PSC';
export const TRAVEL_ACCOUNT = 'Travel Expenses - PSC';
export const CASH_ACCOUNT = 'Cash - PSC';
const CLAIMANT_FIRST_NAME = 'PMO E2E Expense Claimant';

export interface ExpSeed {
  projectId: string;
  erpProject: string;
  employee: string;
  engineerId: string;
  pmId: string;
  financeId: string;
  employeeRowId: string;
  previousCurrency: string;
  previousBinding: Record<string, unknown> | null;
}

async function benchExists(path: string): Promise<boolean> {
  try {
    await benchGet(path);
    return true;
  } catch {
    return false;
  }
}

/** The bench fixtures this journey needs, created once and reused (the bench is disposable). */
async function ensureBenchFixtures(): Promise<string> {
  if (!(await benchExists(`/api/resource/Account/${encodeURIComponent(EMPLOYEE_PAYABLE)}`))) {
    await benchPost('Account', { account_name: 'PMO E2E Employee Payable', parent_account: 'Accounts Payable - PSC',
      company: ERP_COMPANY, account_type: 'Payable', is_group: 0 });
  }
  const filters = encodeURIComponent(JSON.stringify([['first_name', '=', CLAIMANT_FIRST_NAME], ['company', '=', ERP_COMPANY]]));
  const found = (await benchGet(`/api/resource/Employee?filters=${filters}&fields=${encodeURIComponent('["name"]')}`)) as Array<{ name: string }>;
  if (found.length > 0) return found[0].name;
  const created = (await benchPost('Employee', { first_name: CLAIMANT_FIRST_NAME, gender: 'Male', date_of_birth: '1990-01-01',
    date_of_joining: '2024-01-01', company: ERP_COMPANY, status: 'Active' })) as { name: string };
  return created.name;
}

async function profileId(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.from('profiles').select('id').eq('email', email).single();
  if (error || !data) throw new Error(`seed profile ${email} missing: ${error?.message}`);
  return (data as { id: string }).id;
}

export async function signIn(url: string, anonKey: string, email: string): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`sign-in ${email} failed: ${error.message}`);
  return client;
}

export async function seedExp(admin: SupabaseClient, suffix: string): Promise<ExpSeed> {
  const employee = await ensureBenchFixtures();
  const erpProject = await createErpProject(`PMO E2E EXP ${suffix}`);
  const [engineerId, pmId, financeId] = await Promise.all([ENGINEER_EMAIL, PM_EMAIL, FINANCE_EMAIL].map((e) => profileId(admin, e)));

  // The journey decides on the FLAT route (no budget, no senior set). An org-level approver left by another spec
  // would route the claim away from the PM — refuse loudly rather than fail mysteriously.
  const { count } = await admin.from('spend_approvers').select('id', { count: 'exact', head: true })
    .eq('org_id', ORG_ID).is('project_id', null);
  if ((count ?? 0) > 0) throw new Error('AC-EXP-140 needs the flat approval route: remove org-level spend_approvers first');

  // Currency: claims stamp the org default (DD-EXP-11); the bench company keeps IDR books.
  const { data: org } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
  const previousCurrency = (org as { default_currency: string }).default_currency;
  await admin.from('organizations').update({ default_currency: 'IDR' }).eq('id', ORG_ID);

  const projectId = crypto.randomUUID();
  const { error: projectErr } = await admin.from('projects').insert({
    id: projectId, org_id: ORG_ID, name: `EXP-B-${suffix}`, status: 'Ongoing Project', currency: 'IDR', subject_to_vat: false,
  });
  if (projectErr) throw new Error(`seed project failed: ${projectErr.message}`);

  const { data: previous } = await admin.from('external_org_bindings').select('*')
    .eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert({
    org_id: ORG_ID, external_tier: 'erpnext', site_url: ERPNEXT_SITE_URL, secret_ref: 'local-bench',
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15, activated_at: new Date().toISOString(),
    config: { company: ERP_COMPANY, default_cash_account: CASH_ACCOUNT, default_payable_account: 'Creditors - PSC',
      cost_center: 'Main - PSC', project_map: { [projectId]: erpProject } },
  }, { onConflict: 'org_id,external_tier' });
  if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);
  await admin.from('external_domain_ownership').upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'expenses' },
    { onConflict: 'org_id,external_tier,domain' });

  // The Engineer's confirmed ERP Employee link (0148 semantics; seeded, as every served spec does).
  await admin.from('erp_employees').delete().eq('org_id', ORG_ID).eq('profile_id', engineerId);
  const employeeRowId = crypto.randomUUID();
  const { error: empErr } = await admin.from('erp_employees').insert({ id: employeeRowId, org_id: ORG_ID, employee_number: employee,
    employee_name: CLAIMANT_FIRST_NAME, profile_id: engineerId, link_state: 'confirmed', linked_at: new Date().toISOString() });
  if (empErr) throw new Error(`seed erp_employees failed: ${empErr.message}`);
  await admin.from('external_refs').upsert({ org_id: ORG_ID, domain: 'timesheets', pmo_record_id: employeeRowId,
    external_tier: 'erpnext', external_record_id: `Employee:${employee}` }, { onConflict: 'org_id,domain,external_record_id' });

  await admin.from('expense_account_map').delete().eq('org_id', ORG_ID);
  const { error: mapErr } = await admin.from('expense_account_map').insert([
    { org_id: ORG_ID, account_key: 'employee_payable', erp_account: EMPLOYEE_PAYABLE },
    { org_id: ORG_ID, account_key: 'employee_advance', erp_account: EMPLOYEE_ADVANCE },
    { org_id: ORG_ID, account_key: 'Travel', erp_account: TRAVEL_ACCOUNT },
  ]);
  if (mapErr) throw new Error(`seed expense_account_map failed: ${mapErr.message}`);

  return { projectId, erpProject, employee, engineerId, pmId, financeId, employeeRowId, previousCurrency,
    previousBinding: (previous as Record<string, unknown> | null) ?? null };
}

export async function cleanupExp(admin: SupabaseClient, seed: ExpSeed, claimIds: string[]): Promise<void> {
  for (const id of claimIds) {
    await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'expenses').like('pmo_record_id', `${id}%`);
    await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'expenses').like('pmo_record_id', `${id}%`);
  }
  if (claimIds.length) await admin.from('expense_claims').delete().in('id', claimIds); // lines, files, intents cascade
  await admin.from('expense_account_map').delete().eq('org_id', ORG_ID);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', seed.employeeRowId);
  await admin.from('erp_employees').delete().eq('id', seed.employeeRowId);
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'expenses');
  if (seed.previousBinding) {
    await admin.from('external_org_bindings').upsert(seed.previousBinding, { onConflict: 'org_id,external_tier' });
  } else {
    await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  }
  await admin.from('organizations').update({ default_currency: seed.previousCurrency }).eq('id', ORG_ID);
  await admin.from('projects').delete().eq('id', seed.projectId);
}
```

Verify: `cd pmo-portal && npx tsc --noEmit -p e2e/tsconfig.json` (or `npm run typecheck` if it covers `e2e/`) → 0 errors.

### C4 — The served journey (AC-EXP-140)

Create `pmo-portal/e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts`:

```ts
// @e2e-isolation: serial — AC-EXP-140 (#775 phase B): a field claim settled against an advance reaches the ERPNext
// ledger through the sweep, exactly once, tagged to the project. Goal oracle = the ERP documents and the GL mirror.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { benchGet, runSweep, ORG_ID } from './_tspHelpers';
import { CASH_ACCOUNT, EMPLOYEE_ADVANCE, EMPLOYEE_PAYABLE, ENGINEER_EMAIL, FINANCE_EMAIL, PM_EMAIL, TRAVEL_ACCOUNT,
  cleanupExp, seedExp, signIn, type ExpSeed } from './_expHelpers';
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

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
let seed: ExpSeed;
const claimIds: string[] = [];

test.beforeAll(async () => {
  seed = await seedExp(admin, `${Date.now()}`);
});
test.afterAll(async () => {
  if (seed) await cleanupExp(admin, seed, claimIds);
});

type Mirror = { posting: string; push_state: string; erp_name: string | null; push_error: string | null };
const intents = async (claimId: string): Promise<Mirror[]> =>
  ((await admin.from('expense_posting_erp_mirror').select('posting, push_state, erp_name, push_error')
    .eq('claim_id', claimId).order('created_at')).data ?? []) as Mirror[];

test('AC-EXP-140 a claim settled against an advance posts once to ERPNext, tagged to the project', async () => {
  test.setTimeout(180_000);
  const engineer = await signIn(SUPABASE_URL, ANON_KEY, ENGINEER_EMAIL);
  const pm = await signIn(SUPABASE_URL, ANON_KEY, PM_EMAIL);
  const finance = await signIn(SUPABASE_URL, ANON_KEY, FINANCE_EMAIL);
  const rpc = async (client: typeof engineer, id: string, to: string, ref?: string) => {
    const { error } = await client.rpc('transition_expense_claim', { p_id: id, p_to: to, ...(ref ? { p_payment_reference: ref } : {}) });
    expect(error, `${to} ${id}`).toBeNull();
  };

  // ── the Engineer takes a 50,000 advance; PM approves; Finance pays it
  const advanceId = crypto.randomUUID();
  claimIds.push(advanceId);
  expect((await engineer.from('expense_claims').insert({ id: advanceId, kind: 'advance', title: 'Site trip float', project_id: seed.projectId, amount: 50000 })).error).toBeNull();
  await rpc(engineer, advanceId, 'Submitted');
  await rpc(pm, advanceId, 'Approved');
  await rpc(finance, advanceId, 'Paid', 'TRF-ADV-1');

  // ── a 150,000 Travel claim that settles against it; PM approves; Finance pays (50,000 applied, 100,000 cash)
  const claimId = crypto.randomUUID();
  claimIds.unshift(claimId);
  expect((await engineer.from('expense_claims').insert({ id: claimId, kind: 'claim', title: 'Site trip', project_id: seed.projectId, advance_id: advanceId })).error).toBeNull();
  expect((await engineer.from('expense_claim_lines').insert({ claim_id: claimId, expense_date: '2026-10-06', expense_type: 'Travel', description: 'Return bus fare', amount: 150000 })).error).toBeNull();
  await rpc(engineer, claimId, 'Submitted');
  await rpc(pm, claimId, 'Approved');
  await rpc(finance, claimId, 'Paid', 'TRF-EXP-1');

  // ── the sweep is the only originator (ADR-0081)
  expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);

  const claimIntents = await intents(claimId);
  expect(claimIntents.map((m) => `${m.posting}:${m.push_state}`), JSON.stringify(claimIntents))
    .toEqual(['approval:pushed', 'claim-payment:pushed', 'settlement:pushed']);
  const advanceIntents = await intents(advanceId);
  expect(advanceIntents.map((m) => `${m.posting}:${m.push_state}`)).toEqual(['advance-payment:pushed']);
  const byPosting = Object.fromEntries(claimIntents.map((m) => [m.posting, m.erp_name as string]));

  // ── the approval Journal Entry: keyed, project on the expense row, Employee credit
  const { data: claim } = await admin.from('expense_claims').select('approved_at').eq('id', claimId).single();
  const approval = await benchGet<Record<string, unknown>>(`/api/resource/Journal%20Entry/${encodeURIComponent(byPosting.approval)}`);
  expect(approval.docstatus).toBe(1);
  expect(approval.user_remark).toBe(expensePostingKey('approval', claimId, (claim as { approved_at: string }).approved_at));
  const approvalRows = approval.accounts as Array<Record<string, unknown>>;
  expect(approvalRows.find((r) => r.account === TRAVEL_ACCOUNT)).toMatchObject({ debit_in_account_currency: 150000, project: seed.erpProject });
  expect(approvalRows.find((r) => r.account === EMPLOYEE_PAYABLE)).toMatchObject({ credit_in_account_currency: 150000, party_type: 'Employee', party: seed.employee });

  // ── the cash Payment Entry: explicit accounts, references the approval
  const payment = await benchGet<Record<string, unknown>>(`/api/resource/Payment%20Entry/${encodeURIComponent(byPosting['claim-payment'])}`);
  expect(payment).toMatchObject({ docstatus: 1, payment_type: 'Pay', party_type: 'Employee', party: seed.employee,
    paid_from: CASH_ACCOUNT, paid_to: EMPLOYEE_PAYABLE, paid_amount: 100000 });
  expect((payment.references as Array<Record<string, unknown>>)[0]).toMatchObject({ reference_doctype: 'Journal Entry', reference_name: byPosting.approval });

  // ── the settlement Journal Entry: payable (referencing the approval) against the advance account
  const settlement = await benchGet<Record<string, unknown>>(`/api/resource/Journal%20Entry/${encodeURIComponent(byPosting.settlement)}`);
  const settlementRows = settlement.accounts as Array<Record<string, unknown>>;
  expect(settlementRows.find((r) => r.account === EMPLOYEE_PAYABLE)).toMatchObject({ debit_in_account_currency: 50000, reference_name: byPosting.approval });
  expect(settlementRows.find((r) => r.account === EMPLOYEE_ADVANCE)).toMatchObject({ credit_in_account_currency: 50000, party: seed.employee });

  // ── the advance payout went to the advance account
  const advancePe = await benchGet<Record<string, unknown>>(`/api/resource/Payment%20Entry/${encodeURIComponent(advanceIntents[0].erp_name as string)}`);
  expect(advancePe).toMatchObject({ docstatus: 1, paid_to: EMPLOYEE_ADVANCE, paid_amount: 50000 });

  // ── a second tick posts nothing new, and feeds the GL mirror (field cost reaches project actuals)
  expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);
  const jeFilter = encodeURIComponent(JSON.stringify([['user_remark', 'like', `%${claimId}%`]]));
  expect(await benchGet<unknown[]>(`/api/resource/Journal%20Entry?filters=${jeFilter}&limit_page_length=0`)).toHaveLength(2);
  const peFilter = encodeURIComponent(JSON.stringify([['reference_no', 'like', `%${claimId}%`]]));
  expect(await benchGet<unknown[]>(`/api/resource/Payment%20Entry?filters=${peFilter}&limit_page_length=0`)).toHaveLength(1);
  const { data: gl } = await admin.from('erp_gl_entry_mirror').select('account, project, debit')
    .eq('org_id', ORG_ID).eq('voucher_no', byPosting.approval).eq('account', TRAVEL_ACCOUNT).eq('is_cancelled', false);
  expect(gl).toEqual([{ account: TRAVEL_ACCOUNT, project: seed.erpProject, debit: 150000 }]);
});
```

### C5 — Register the skip and run the journey

1. `scripts/check-e2e-skips.mjs` — in `ALLOWED_SKIPS`, after the `serial/AC-PB-003-progress-billing-erp.spec.ts` entry:

```js
  {
    file: 'serial/AC-EXP-140-expense-postings-erp.spec.ts',
    reason: 'Expense posting ledger proof needs the served functions lane (it drives erpnext-sweep) and the throwaway ERPNext bench (its goal oracle is the ERP documents and the GL mirror); the bench is not provisioned in CI.',
    restore: 'Run with scripts/serve-functions.sh against the local ERPNext bench, with the bench API key exported.',
    verified: '2026-10-07',
  },
```

   Verify: `node scripts/check-e2e-skips.mjs --self-test` → PASS; `bash scripts/check-e2e-isolation.sh` → PASS.
2. Run locally (bench up, functions served, bench key exported by the Director — never read an env file):
   `scripts/with-erpnext-lock.sh scripts/with-db-lock.sh scripts/e2e-local.sh AC-EXP-140` → 1 passed.
   If the GL assertion is the only red, re-check C0 (#901) before anything else.

### C6 — Pre-enable checklist for a client site (owner/operator; recorded on #775, no hostnames, no credentials)

Before an Admin employs `expenses` on a real client's ERPNext, the operator runs the spike's §8 checks on that site
(read-only GETs + one disposable Journal/Payment Entry pair, cancelled afterwards) and records the answers on the issue:

1. `get_versions` — is `hrms` present (owner Q1)? If yes, confirm checks 2–4 still pass and that nobody books native
   HRMS Expense Claims (double-booking).
2. Re-run spike Probes 2, 3 and the advance-applied JE with the client's accounts: Employee party accepted on the
   payable and advance accounts.
3. A Payment Entry with explicit `paid_to` and a `Journal Entry` reference submits.
4. `Journal Entry` meta: `user_remark` is still not `allow_on_submit`.
5. The client's COA has a Liability/Payable employee payable account (not `Creditors`) and an Asset/Payable employee
   advance account (owner Q7) — the Admin then saves them in Administration › Accounting › Expense account map.
6. Every claimant has a confirmed ERP Employee link (Administration › ERP setup › unlinked employees = 0 for them).
7. The org's `default_currency` equals the ERPNext company currency.

### C7 — Part 6 gate and PR

`npm run typecheck`; touched ESLint; `../scripts/with-test-lock.sh npx vitest run --changed origin/dev`;
`bash scripts/deno-test-edge-fns.sh`; the five 0270 pgTAP files + 0178 under one lock hold; the AC-EXP-140 journey.
PR to `dev` (release-engineer) with: M1–M14 results, the C0 evidence, the AC traceability table (part 1 §1.7), and the
owner questions Q7–Q10 (spec §9) restated.

### C8 — Rendered Discover pass (design-reviewer)

Rich seed, served lane: Administration › Accounting › Expense account map (Admin and Finance), and an expense record
whose postings are Queued / Posted / Failed / Needs an operator / Cancelled in ERPNext. Every finding graduates
(`docs/qa-portfolio.md`).

### C9 — Hand-back

Report the plan's ACs as covered per §1.7 and list anything deferred. Phase B is complete when C7 is green on CI.
