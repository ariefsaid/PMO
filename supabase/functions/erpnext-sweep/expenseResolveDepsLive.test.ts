// AC-EXP-115 [Deno, live wiring] — `expenseResolveDepsLive` (the SHIPPED export of index.ts): which binding config keys
// the resolver reads, the live ERPNext Company facts (currency AND the supplier payable account — never the binding's
// stored copy), the approval-outbox lookup and the account map, against a recording fake client and a stubbed fetch.
// Verify: cd supabase/functions/erpnext-sweep && deno test expenseResolveDepsLive.test.ts --config deno.json --allow-env --allow-net --allow-read

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { expenseResolveDepsLive } = await import('./index.ts');
type OrgBinding = Parameters<typeof expenseResolveDepsLive>[1];

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const ORG = '00000000-0000-4000-8000-0000000000e2';
const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';

const binding = (config: Record<string, unknown>, company: string | null = ' Example Co ') => ({
  orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'ref', company, config, ownedDomains: ['expenses'], versionMajor: 15,
} as OrgBinding);

/** The ERP credentials are already resolved for this tick (the sweep's per-tick cache). */
const cache = () => new Map([[ORG, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);

function fakeClient(rows: unknown) {
  const calls: Array<{ table: string; ops: Array<[string, ...unknown[]]> }> = [];
  const client = {
    from: (table: string) => {
      const call = { table, ops: [] as Array<[string, ...unknown[]]> };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'like', 'limit']) {
        chain[m] = (...args: unknown[]) => {
          call.ops.push([m, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
      return chain;
    },
  };
  return { client, calls };
}

async function withErp<T>(docs: Record<string, unknown>, fn: () => Promise<T>): Promise<{ result: T; paths: string[] }> {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = decodeURIComponent(url.pathname);
    paths.push(path);
    const doc = docs[path];
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

Deno.test('AC-EXP-115 the binding facts come from the company and the config keys (cash before bank, cost_center, project_map)', async () => {
  const deps = expenseResolveDepsLive(fakeClient([]).client as never, binding({
    default_cash_account: ' Cash - EX ', default_bank_account: 'Bank - EX', cost_center: 'Main - EX',
    project_map: { 'proj-1': 'PROJ-0001' }, default_payable_account: 'Stale Creditors - EX',
  }), cache());
  assertEquals(await deps.readBinding(), { company: 'Example Co', cashAccount: 'Cash - EX', costCenter: 'Main - EX', projectMap: { 'proj-1': 'PROJ-0001' } });
  const bankOnly = expenseResolveDepsLive(fakeClient([]).client as never, binding({ default_cash_account: '  ', default_bank_account: 'Bank - EX' }, null), cache());
  assertEquals(await bankOnly.readBinding(), { company: null, cashAccount: 'Bank - EX', costCenter: null, projectMap: {} });
});

Deno.test('AC-EXP-115 one live Company read gives the currency and the supplier payable account', async () => {
  // A fresh deps per case: the ERP client binds `fetch` when it is first built (once per tick in production).
  const deps = () => expenseResolveDepsLive(fakeClient([]).client as never, binding({ default_payable_account: 'Stale Creditors - EX' }), cache());
  const { result, paths } = await withErp({
    '/api/resource/Company/Example Co': { name: 'Example Co', default_currency: 'IDR', default_payable_account: 'Creditors - EX' },
  }, () => deps().readErpCompany('Example Co'));
  assertEquals(result, { currency: 'IDR', defaultPayableAccount: 'Creditors - EX' });
  assertEquals(paths, ['/api/resource/Company/Example Co']);
  const missing = await withErp({}, () => deps().readErpCompany('Ghost Co'));
  assertEquals(missing.result, null);
  const unnamed = await withErp({ '/api/resource/Company/Example Co': { name: 'Example Co', default_currency: 'IDR' } },
    () => deps().readErpCompany('Example Co'));
  assertEquals(unnamed.result, { currency: 'IDR', defaultPayableAccount: null });
});

Deno.test('AC-EXP-115 the approval-outbox lookup is this org\'s expenses command for the approval identity and key prefix', async () => {
  const hit = fakeClient([{ id: 'ob-1' }]);
  assertEquals(await expenseResolveDepsLive(hit.client as never, binding({}), cache()).readApprovalOutboxExists(CLAIM), true);
  assertEquals(hit.calls[0].table, 'external_command_outbox');
  assertEquals(hit.calls[0].ops, [['select', 'id'], ['eq', 'org_id', ORG], ['eq', 'domain', 'expenses'],
    ['eq', 'pmo_record_id', `${CLAIM}:approval`], ['like', 'idempotency_key', 'expj:%'], ['limit', 1]]);
  const none = fakeClient([]);
  assertEquals(await expenseResolveDepsLive(none.client as never, binding({}), cache()).readApprovalOutboxExists(CLAIM), false);
});

Deno.test('AC-EXP-115 the account map is read for this org, keyed by account key', async () => {
  const f = fakeClient([{ account_key: 'employee_payable', erp_account: 'Employee Payable - EX' }, { account_key: 'Meals', erp_account: 'Meals - EX' }]);
  assertEquals(await expenseResolveDepsLive(f.client as never, binding({}), cache()).readAccountMap(),
    { employee_payable: 'Employee Payable - EX', Meals: 'Meals - EX' });
  assertEquals(f.calls[0].ops, [['select', 'account_key, erp_account'], ['eq', 'org_id', ORG]]);
});
