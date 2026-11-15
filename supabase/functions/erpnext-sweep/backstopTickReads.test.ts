// AC-2120-1 [Deno, live wiring] — the posting backstops' live deps (`expensePostingBackstopDepsLive`,
// `imprestPostingBackstopDepsLive`, the SHIPPED exports of index.ts) read the account map and the ERPNext Company once
// per pass however many intents they resolve, and a new pass (the next tick, or another org) reads again.
// Verify: cd supabase/functions/erpnext-sweep && deno test backstopTickReads.test.ts --config deno.json --allow-env --allow-net --allow-read

import "../_shared/testing/publicErpDns.ts";
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { expensePostingBackstopDepsLive, imprestPostingBackstopDepsLive } = await import('./index.ts');
type OrgBinding = Parameters<typeof expensePostingBackstopDepsLive>[1];
type ExpenseTruth = Parameters<ReturnType<typeof expensePostingBackstopDepsLive>['resolve']>[0];
type ImprestTruth = Parameters<ReturnType<typeof imprestPostingBackstopDepsLive>['resolve']>[0];

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const ORG = '00000000-0000-4000-8000-0000000021a0';
const ORG_BINDING = {
  orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'ref', company: 'Example Co',
  config: { default_cash_account: 'Cash - EX', default_bank_account: 'Bank - EX' }, ownedDomains: ['expenses'], versionMajor: 15,
} as OrgBinding;
const cache = () => new Map([[ORG, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);

/** A service client that answers every table read and counts them by table. */
function fakeClient() {
  const reads: string[] = [];
  const rows: Record<string, unknown> = {
    expense_account_map: [{ account_key: 'employee_payable', erp_account: 'Employee Payable - EX' }],
    erp_employees: { id: 'emp-1' },
    external_refs: { external_record_id: 'Employee:HR-EMP-00001' },
  };
  const client = {
    from: (table: string) => {
      reads.push(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'like', 'limit', 'in', 'is']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: rows[table] ?? null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? null, error: null }).then(resolve);
      return chain;
    },
  };
  return { client, reads };
}

const ACCOUNT = (name: string, over: Record<string, unknown>) => ({ name, company: 'Example Co', is_group: 0, disabled: 0, account_currency: 'IDR', ...over });
const ERP_DOCS: Record<string, unknown> = {
  '/api/resource/Company/Example Co': { name: 'Example Co', default_currency: 'IDR', default_payable_account: 'Creditors - EX' },
  '/api/resource/Account/Employee Payable - EX': ACCOUNT('Employee Payable - EX', { root_type: 'Liability', account_type: 'Payable' }),
  '/api/resource/Account/Site Cash F - EX': ACCOUNT('Site Cash F - EX', { root_type: 'Asset', account_type: 'Cash' }),
  '/api/resource/Account/Bank - EX': ACCOUNT('Bank - EX', { root_type: 'Asset', account_type: 'Bank' }),
};

async function withErp<T>(fn: () => Promise<T>): Promise<{ result: T; paths: string[] }> {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = decodeURIComponent(url.pathname);
    paths.push(path);
    const doc = ERP_DOCS[path];
    return Promise.resolve(doc
      ? new Response(JSON.stringify({ data: doc }), { status: 200 })
      : new Response(JSON.stringify({ exc_type: 'DoesNotExistError' }), { status: 404 }));
  }) as typeof fetch;
  try {
    return { result: await fn(), paths };
  } finally {
    globalThis.fetch = original;
  }
}

const claimPayment = (i: number): ExpenseTruth => ({
  mirror_id: `m-${i}`, posting: 'claim-payment', posting_identity: `c-${i}:claim-payment`, subject_id: `c-${i}`, claim_id: `c-${i}`,
  claim_number: `EXP-${i}`, claimant_id: `u-${i}`, project_id: null, project_is_internal: false, float_cash_account: null, currency: 'IDR',
  amount: '100.00', lines: [], state_stamp: '2026-10-07T10:00:00+00:00', posting_date: '2026-10-07', approval_posting_exists: false, actor_id: 'u-pm',
} as ExpenseTruth);

Deno.test('AC-2120-1 one expense backstop pass resolving 20 claims reads the account map and the ERP Company once each', async () => {
  const f = fakeClient();
  const deps = expensePostingBackstopDepsLive(f.client as never, ORG_BINDING, [], cache());
  const { result, paths } = await withErp(async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 20; i += 1) outcomes.push((await deps.resolve(claimPayment(i))).outcome);
    return outcomes;
  });
  assertEquals(result, Array(20).fill('ready'), 'every claim resolves');
  assertEquals(f.reads.filter((t) => t === 'expense_account_map').length, 1, 'account map');
  assertEquals(paths.filter((p) => p.startsWith('/api/resource/Company/')).length, 1, 'ERP company');
  assertEquals(paths.filter((p) => p.startsWith('/api/resource/Account/')).length, 20, 'accounts stay per claim');
  assertEquals(f.reads.filter((t) => t === 'erp_employees').length, 20, 'the claimant stays per claim');

  // The next pass (a new tick, or another org) builds new deps and reads again.
  const next = expensePostingBackstopDepsLive(f.client as never, ORG_BINDING, [], cache());
  const again = await withErp(() => next.resolve(claimPayment(0)));
  assertEquals(again.paths.filter((p) => p.startsWith('/api/resource/Company/')).length, 1, 'a fresh pass re-reads the company');
  assertEquals(f.reads.filter((t) => t === 'expense_account_map').length, 2, 'a fresh pass re-reads the map');
});

Deno.test('AC-2120-1 one imprest backstop pass resolving 20 transfers reads the ERP Company once', async () => {
  const f = fakeClient();
  const deps = imprestPostingBackstopDepsLive(f.client as never, ORG_BINDING, [], cache());
  const truth = (i: number) => ({
    mirror_id: `m-${i}`, posting_identity: `r-${i}:replenishment`, subject_id: `r-${i}`, number: `REP-${i}`, kind: 'replenishment',
    amount: '800.00', currency: 'IDR', float_id: 'f1', float_cash_account: 'Site Cash F - EX', reference: 'B', state_stamp: '2026-10-07T10:00:00+00:00',
    posting_date: '2026-11-01', actor_id: 'u-admin',
  } as ImprestTruth);
  const { result, paths } = await withErp(async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 20; i += 1) outcomes.push((await deps.resolve(truth(i))).outcome);
    return outcomes;
  });
  assertEquals(result, Array(20).fill('ready'), 'every transfer resolves');
  assertEquals(paths.filter((p) => p.startsWith('/api/resource/Company/')).length, 1, 'ERP company');
});
