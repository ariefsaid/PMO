/**
 * dispatchFactory.budget.test.ts — P3c dispatch wiring for the `budget` domain (AC-BUD-011/012).
 *
 * These are BEHAVIOUR tests at the adapter boundary, not shape tests: each one drives a real
 * `resolveErpDispatchAdapter(...).commit(...)` with a fetch spy, so "fails closed BEFORE any ERP call"
 * is asserted as ZERO HTTP requests, which is the property that actually matters (a category resolved to
 * the wrong account, or a budget pushed with no project dimension, mis-configures the client's real GL
 * controls).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import { DOCTYPE_BODIES } from './doctypeBodies';

const MAP_ROWS = [
  { category: 'Labor', erp_account: 'Salary - PSC' },
  { category: 'Materials', erp_account: 'Cost of Goods Sold - PSC' },
];

const BINDING = {
  site_url: 'https://erp.example.com',
  version_major: 15,
  activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co', project_map: { 'proj-1': 'PROJ-0001' } },
};

/** `<table>:<id>` -> the row's REAL org_id (org-1 = the caller, org-2 = another tenant). */
const ROWS: Record<string, { org_id: string }> = {
  'projects:proj-1': { org_id: 'org-1' },
  'projects:proj-org2': { org_id: 'org-2' },
};

function serviceClient(mapRows: unknown[] = MAP_ROWS): DispatchServiceClient {
  return {
    from: (table: string) => ({
      select: () => {
        let filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => {
            filters = { ...filters, [col]: val };
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === 'external_org_bindings') return { data: BINDING, error: null };
            return { data: ROWS[`${table}:${filters.id}`] ?? null, error: null };
          },
          // list reads: the org's category→account map
          then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
            resolve({ data: table === 'budget_category_account_map' ? mapRows : [], error: null }),
        };
        return chain;
      },
    }),
  } as unknown as DispatchServiceClient;
}

const VERSION_RECORD = {
  id: 'ver-1',
  erp_doc_kind: 'budget',
  projectId: 'proj-1',
  fiscal_year: '2026',
  line_items: [
    { category: 'Labor', budgeted_amount: '50000.00' },
    { category: 'Materials', budgeted_amount: '25000.00' },
  ],
};

function erpFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'BUDGET-2026-00001' }), { status: 200 });
    if (init?.method === 'PUT') return new Response(JSON.stringify({ name: 'BUDGET-2026-00001', docstatus: 1 }), { status: 200 });
    return new Response(
      JSON.stringify({ name: 'BUDGET-2026-00001', docstatus: 1, modified: '2026-07-20 10:00:00', fiscal_year: '2026' }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

async function commitBudget(
  record: Record<string, unknown> = VERSION_RECORD,
  opts: { orgId?: string; fetchImpl?: typeof fetch; mapRows?: unknown[] } = {},
) {
  const fetchImpl = opts.fetchImpl ?? erpFetch();
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient(opts.mapRows ?? MAP_ROWS),
    orgId: opts.orgId ?? 'org-1',
    command: { domain: 'budget', operation: 'create', record } as never,
    fetchImpl,
    apiKey: 'k',
    apiSecret: 's',
    doctypeBodies: DOCTYPE_BODIES,
  });
  const result = await adapter.commit({
    domain: 'budget',
    operation: 'create',
    record,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  } as never);
  return { result, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

describe('P3c dispatch wiring — the budget domain', () => {
  it('AC-BUD-012 resolves the ERP project from the binding map and the accounts from the org map table', async () => {
    const { result, fetchImpl } = await commitBudget();

    const post = fetchImpl.mock.calls.find((c: unknown[]) => (c[1] as RequestInit)?.method === 'POST');
    expect(post).toBeDefined();
    expect(String(post![0])).toContain('/api/resource/Budget');
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body).toMatchObject({
      company: 'PMO Smoke Co',
      fiscal_year: '2026',
      budget_against: 'Project',
      project: 'PROJ-0001',
      accounts: [
        { account: 'Salary - PSC', budget_amount: '50000.00' },
        { account: 'Cost of Goods Sold - PSC', budget_amount: '25000.00' },
      ],
      action_if_annual_budget_exceeded: 'Warn',
    });
    expect(result.externalRecordId).toBe('BUDGET-2026-00001');
    // submitOnCreate: the pushed Budget is SUBMITTED — a draft enforces nothing in ERP.
    expect(result.canonical.erp_docstatus).toBe(1);
    // ⚑ lifecycle only: no ERP-side money figure comes back into PMO.
    expect(result.canonical).not.toHaveProperty('accounts');
  });

  it('AC-BUD-011 ⚑ an UNMAPPED category refuses the whole push with ZERO ERP calls (no partial budget)', async () => {
    const fetchImpl = erpFetch();
    await expect(
      commitBudget(
        {
          ...VERSION_RECORD,
          line_items: [
            { category: 'Labor', budgeted_amount: '50000.00' }, // mapped
            { category: 'Contingency', budgeted_amount: '10000.00' }, // UNMAPPED
          ],
        },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: 'budget-category-unmapped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-BUD-011 an org with NO map rows pushes nothing at all (fail closed, not an empty budget)', async () => {
    const fetchImpl = erpFetch();
    await expect(commitBudget(VERSION_RECORD, { fetchImpl, mapRows: [] })).rejects.toMatchObject({
      code: 'budget-category-unmapped',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-BUD-012 a projectId owned by ANOTHER org is rejected before any ERP write (cross-org pre-flight)', async () => {
    const fetchImpl = erpFetch();
    await expect(
      commitBudget({ ...VERSION_RECORD, projectId: 'proj-org2' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-BUD-012 a command with NO project is rejected — never an unattributed, org-wide budget', async () => {
    const fetchImpl = erpFetch();
    const { projectId: _omitted, ...noProject } = VERSION_RECORD;
    await expect(commitBudget(noProject, { fetchImpl })).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AC-BUD-012 a non-budget command is byte-for-byte unaffected (no map read, no config mutation)', async () => {
    const tables: string[] = [];
    const client = {
      from: (table: string) => {
        tables.push(table);
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              order: () => chain,
              limit: () => chain,
              maybeSingle: async () =>
                table === 'external_org_bindings' ? { data: BINDING, error: null } : { data: null, error: null },
              then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: [], error: null }),
            };
            return chain;
          },
        };
      },
    } as unknown as DispatchServiceClient;

    await resolveErpDispatchAdapter({
      serviceClient: client,
      orgId: 'org-1',
      command: { domain: 'companies', operation: 'create', record: { id: 'c-1', erp_doc_kind: 'supplier' } } as never,
      fetchImpl: erpFetch(),
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: DOCTYPE_BODIES,
    });
    expect(tables).not.toContain('budget_category_account_map');
  });
});
