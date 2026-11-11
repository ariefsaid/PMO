import { describe, it, expect, vi } from 'vitest';
import { resolveErpDispatchAdapter } from './dispatchFactory';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { budgetAccountIdentity, budgetRangeIdentity } from './budgetAccountIdentity';

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

const RANGE_YEARS = [
  { name: '2026', start: '2026-01-01', end: '2026-12-31' },
  { name: '2027', start: '2027-01-01', end: '2027-12-31' },
];
const RANGE_IDENTITY = budgetRangeIdentity(VID, '2026', '2027', 'Salary');
const RANGE_OUTBOX = '55555555-5555-4555-8555-555555555555';
const RANGE_DIGEST = 'a'.repeat(64);

function rangeCommand() {
  return {
    domain: 'budget', operation: 'create', idempotencyKey: `bud16:${RANGE_IDENTITY}:1793779200000`,
    record: {
      id: VID, erp_doc_kind: 'budget', budget_mode: 'whole_project', projectId: 'project',
      fiscal_year: '2026', to_fiscal_year: '2027', fiscal_years: RANGE_YEARS,
      year_amounts: [{ year: '2026', amount: '50.00' }, { year: '2027', amount: '50.00' }],
      line_items: [{ category: 'Labor', budgeted_amount: '100.00' }],
      erp_account: 'Salary', budget_intent: 'ensure', budget_predecessor: null,
      outbox_identity: RANGE_IDENTITY, project_start_date: '2026-01-01', project_end_date: '2027-12-31',
      activated_at: '2026-01-01T00:00:00Z',
    },
  };
}

function rangeServiceClient(rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const client = {
    rpc: vi.fn(rpc),
    from(table: string) {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            is() { return chain; },
            gte() { return chain; },
            order() { return chain; },
            limit() { return chain; },
            gt() { return chain; },
            maybeSingle: async () => {
              if (table === 'external_org_bindings') return { data: {
                site_url: 'https://erp.test', version_major: 16, activated_at: '2026-01-01T00:00:00Z',
                config: { company: 'Test Co', project_map: { project: 'ERP-PROJ' } },
              }, error: null };
              if (table === 'projects') return { data: { org_id: 'org' }, error: null };
              return { data: null, error: null };
            },
            then(resolve: (value: unknown) => unknown) {
              resolve({
                data: table === 'budget_category_account_map' ? [{ category: 'Labor', erp_account: 'Salary' }] : [],
                error: null,
              });
            },
          };
          return chain;
        },
      };
    },
  };
  return client;
}

async function makeRangeAdapter(
  serviceClient: ReturnType<typeof rangeServiceClient>,
  fetchImpl: typeof fetch,
) {
  return resolveErpDispatchAdapter({
    serviceClient: serviceClient as never,
    orgId: 'org', command: rangeCommand() as never,
    fetchImpl, apiKey: 'key', apiSecret: 'secret', doctypeBodies: DOCTYPE_BODIES,
  });
}

// Refusing a live budget PMO did not create (and two live budgets) moved to the shared `budget.unowned-occupant`
// suite (contractSuite/budget.suite.ts). What stays here is ERPNext's own request shape.
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

describe('whole-project range outbox RPC adapter', () => {
  const makeRangeFetcher = () => vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('frappe.auth.get_logged_user')) return Response.json({ message: 'api-user' });
    if (url.includes('/api/resource/Budget?')) return Response.json({ data: [] });
    throw new Error('stop after staged range claim');
  }) as unknown as typeof fetch;

  it('maps an out-of-fence read RPC to command-held with the exact claim arguments', async () => {
    const fetchImpl = makeRangeFetcher();
    const serviceClient = rangeServiceClient(async () => ({
      data: null, error: { code: 'P0001', message: 'fenced claim changed' },
    }));
    const adapter = await makeRangeAdapter(serviceClient, fetchImpl);
    await expect(adapter.commit({
      ...rangeCommand(), outboxCommit: {
        id: RANGE_OUTBOX, generation: 7, payloadDigest: RANGE_DIGEST, identity: RANGE_IDENTITY,
      },
    } as never)).rejects.toMatchObject({ code: 'command-held' });

    expect(serviceClient.rpc).toHaveBeenCalledWith('read_budget_range_outbox_state', {
      p_id: RANGE_OUTBOX, p_generation: 7, p_payload_digest: RANGE_DIGEST, p_identity: RANGE_IDENTITY,
    });
  });

  it('maps stage-advance RPC failures to external-unreachable and binds the expected stage', async () => {
    const fetchImpl = makeRangeFetcher();
    const serviceClient = rangeServiceClient(async (name) => name === 'read_budget_range_outbox_state'
      ? { data: null, error: null }
      : { data: null, error: { code: 'P0001', message: 'stage write unavailable' } });
    const adapter = await makeRangeAdapter(serviceClient, fetchImpl);
    await expect(adapter.commit({
      ...rangeCommand(), outboxCommit: {
        id: RANGE_OUTBOX, generation: 3, payloadDigest: RANGE_DIGEST, identity: RANGE_IDENTITY,
      },
    } as never)).rejects.toMatchObject({ code: 'external-unreachable' });

    expect(serviceClient.rpc).toHaveBeenLastCalledWith('advance_budget_range_outbox_stage', {
      p_id: RANGE_OUTBOX, p_generation: 3, p_payload_digest: RANGE_DIGEST, p_identity: RANGE_IDENTITY,
      p_expected_stage: null, p_next: expect.objectContaining({ stage: 'post_started', identity: RANGE_IDENTITY }),
    });
  });

  it('accepts the RPC numeric success result before proceeding to the external create', async () => {
    const fetchImpl = makeRangeFetcher();
    const serviceClient = rangeServiceClient(async (name) => name === 'read_budget_range_outbox_state'
      ? { data: null, error: null }
      : { data: 1, error: null });
    const adapter = await makeRangeAdapter(serviceClient, fetchImpl);
    await expect(adapter.commit({
      ...rangeCommand(), outboxCommit: {
        id: RANGE_OUTBOX, generation: 4, payloadDigest: RANGE_DIGEST, identity: RANGE_IDENTITY,
      },
    } as never)).rejects.toMatchObject({ code: 'external-unreachable' });

    expect(serviceClient.rpc).toHaveBeenCalledWith('advance_budget_range_outbox_stage', expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/api/resource/Budget'), expect.objectContaining({ method: 'POST' }));
  });
});
