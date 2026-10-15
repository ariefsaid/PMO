import { describe, it, expect, vi } from 'vitest';
import { resolveErpDispatchAdapter } from './dispatchFactory';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { budgetAccountIdentity } from './budgetAccountIdentity';

const VID = '44444444-4444-4444-8444-444444444444';
const calls: Array<{ table: string; filters: Record<string, string> }> = [];

function db() {
  return { from(table: string) { return { select() {
    const filters: Record<string, string> = {};
    const chain = {
      eq(column: string, value: string) { filters[column] = value; return chain; },
      order() { return chain; }, limit() { return chain; }, gt() { return chain; },
      maybeSingle: async () => {
        calls.push({ table, filters: { ...filters } });
        if (table === 'external_org_bindings') return { data: {
          site_url: 'https://erp.test', version_major: 16, activated_at: '2026-01-01T00:00:00Z',
          config: { company: 'Test Co', project_map: { project: 'ERP-PROJ' } },
        }, error: null };
        if (table === 'projects') return { data: { org_id: 'org' }, error: null };
        if (table === 'external_refs') return { data: null, error: null };
        if (table === 'budget_version_account_erp_mirror') return { data: null, error: null };
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        resolve({ data: table === 'budget_category_account_map' ? [{ category: 'Labor', erp_account: 'Salary' }] : [], error: null });
      },
    };
    return chain;
  } }; } } as never;
}

const record = (account: string) => ({
  id: VID, erp_doc_kind: 'budget', projectId: 'project', fiscal_year: '2026',
  line_items: [{ category: 'Labor', budgeted_amount: '50000.00' }],
  erp_account: account, budget_intent: 'ensure', budget_predecessor: null, outbox_identity: budgetAccountIdentity(VID, '2026', account),
});

function fetcher(grain: Array<Record<string, unknown>> = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ data: { name: 'BUD-1' } }), { status: 200 });
    if (String(url).includes('filters=')) return new Response(JSON.stringify({ data: grain }), { status: 200 });
    return new Response(JSON.stringify({ data: {
      name: 'BUD-1', docstatus: 1, modified: '2026-01-01', from_fiscal_year: '2026',
      to_fiscal_year: '2026', account: 'Salary', company: 'Test Co', project: 'ERP-PROJ', budget_amount: '50000.00',
    } }), { status: 200 });
  }) as unknown as typeof fetch;
}

async function makeAdapter(unit: ReturnType<typeof record>, fetchImpl: typeof fetch) {
  return resolveErpDispatchAdapter({
    serviceClient: db(), orgId: 'org', command: { domain: 'budget', operation: 'create', record: unit } as never,
    fetchImpl, apiKey: 'key', apiSecret: 'secret', doctypeBodies: DOCTYPE_BODIES,
  });
}

describe('v16 budget factory binding and selected account', () => {
  it('AC-BV16-005 derives v16 body from binding and emits only the selected account', async () => {
    calls.length = 0;
    const transport = fetcher();
    const adapter = await makeAdapter(record('Salary'), transport);
    await adapter.commit({ domain: 'budget', operation: 'create', record: record('Salary'), idempotencyKey: 'bud16:test' } as never);
    const post = (transport as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) => (call[1] as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({ account: 'Salary', from_fiscal_year: '2026' });
  });

  it('rejects an account absent from the current map before any ERP request', async () => {
    const transport = fetcher();
    await expect(makeAdapter(record('Forged'), transport)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses unowned and ambiguous live account occupants with account/year context and no writes', async () => {
    const cases: Array<[Array<Record<string, unknown>>, string]> = [
      [[{ name: 'DESK-BUDGET', docstatus: 1 }], 'budget-unowned-live-occupant'],
      [[{ name: 'LIVE-1', docstatus: 1 }, { name: 'LIVE-2', docstatus: 1 }], 'commit-rejected'],
    ];
    for (const [grain, expectedCode] of cases) {
      const transport = fetcher(grain);
      const error = await makeAdapter(record('Salary'), transport).then(() => null, (caught) => caught as Error & { code?: string });
      expect(error).toMatchObject({ code: expectedCode });
      expect(error?.message).toMatch(/Salary.*2026|2026.*Salary/);
      expect((transport as unknown as ReturnType<typeof vi.fn>).mock.calls.every((call: unknown[]) =>
        !['POST', 'PUT'].includes(String((call[1] as RequestInit)?.method)))).toBe(true);
    }
  });

  it('AC-BV16-005 probes only the v16 account/year grain and refuses a draft without writes', async () => {
    const transport = fetcher([{ name: 'BUD-DRAFT', docstatus: 0 }]);
    await expect(makeAdapter(record('Salary'), transport)).rejects.toMatchObject({ code: 'budget-draft-rival-on-grain' });
    const list = (transport as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) => String(call[0]).includes('filters='));
    const filters = JSON.parse(new URL(String(list?.[0])).searchParams.get('filters') ?? '[]');
    expect(filters).toEqual(expect.arrayContaining([
      ['company', '=', 'Test Co'], ['project', '=', 'ERP-PROJ'], ['account', '=', 'Salary'],
      ['from_fiscal_year', '=', '2026'], ['docstatus', '<', 2],
    ]));
    expect(filters.some((filter: unknown[]) => filter[0] === 'fiscal_year')).toBe(false);
    expect((transport as unknown as ReturnType<typeof vi.fn>).mock.calls.every((call: unknown[]) => (call[1] as RequestInit)?.method !== 'POST' && (call[1] as RequestInit)?.method !== 'PUT')).toBe(true);
  });
});
