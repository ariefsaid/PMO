import { describe, expect, it, vi } from 'vitest';
import { resolveBudgetRefs } from './dispatchBudget.ts';
import { budgetRangeIdentity } from './budgetAccountIdentity.ts';
import type { ErpDispatchFactoryDeps } from './dispatchTypes.ts';

const VERSION = '11111111-1111-4111-8111-111111111111';
const PREVIOUS_VERSION = '22222222-2222-4222-8222-222222222222';
const CALENDAR = [
  { name: 'FY25', start: '2025-01-01', end: '2025-12-31' },
  { name: 'FY26', start: '2026-01-01', end: '2026-12-31' },
  { name: 'FY27', start: '2027-01-01', end: '2027-12-31' },
];
const MODIFIED = '2026-01-04 10:00:00';

function rangeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION,
    erp_doc_kind: 'budget',
    budget_mode: 'whole_project',
    budget_intent: 'ensure',
    projectId: 'pmo-project',
    fiscal_year: 'FY26',
    to_fiscal_year: 'FY26',
    fiscal_years: CALENDAR,
    line_items: [{ category: 'Labor', budgeted_amount: '1000.00' }],
    erp_account: 'Salary',
    outbox_identity: budgetRangeIdentity(VERSION, 'FY26', 'FY26', 'Salary'),
    budget_predecessor: null,
    ...overrides,
  };
}

function candidate(name: string, from: string, to: string, docstatus = 1, modified = MODIFIED) {
  return {
    name,
    company: 'Test Co',
    project: 'ERP-PROJ',
    account: 'Salary',
    docstatus,
    from_fiscal_year: from,
    to_fiscal_year: to,
    modified,
  };
}

function erp(rows: Array<Record<string, unknown>>) {
  const fetchImpl = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    const filters = JSON.parse(parsed.searchParams.get('filters') ?? '[]') as Array<[string, string, unknown]>;
    const fields = JSON.parse(parsed.searchParams.get('fields') ?? '[]') as string[];
    const limit = Number(parsed.searchParams.get('limit_page_length'));
    const matches = rows.filter((row) => filters.every(([field, operator, expected]) => {
      const value = row[field];
      if (operator === '=') return String(value) === String(expected);
      if (operator === '<') return Number(value) < Number(expected);
      if (operator === '>') return String(value) > String(expected);
      throw new Error(`unsupported ERP filter ${operator}`);
    })).sort((left, right) => String(left.name).localeCompare(String(right.name)));
    return new Response(JSON.stringify({ data: matches.slice(0, limit).map((row) =>
      Object.fromEntries(fields.map((field) => [field, row[field]]))) }), { status: 200 });
  }) as unknown as typeof fetch;
  return fetchImpl;
}

function serviceClient(opts: {
  sourceIdentity?: string;
  mirror?: Record<string, unknown>;
  rangeOutbox?: Record<string, unknown>;
} = {}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq(column: string, value: string | boolean) { filters[column] = value; return chain; },
        is: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        gt: () => chain,
        maybeSingle: async () => table === 'external_refs'
          ? { data: opts.sourceIdentity ? { pmo_record_id: opts.sourceIdentity } : null, error: null }
          : table === 'external_command_outbox'
            ? { data: opts.rangeOutbox ?? null, error: null }
            : { data: opts.mirror ?? null, error: null },
        then(resolve: (value: unknown) => unknown) { resolve({ data: null, error: null }); },
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as ErpDispatchFactoryDeps['serviceClient'];
}

function deps(
  record: ReturnType<typeof rangeRecord>,
  fetchImpl: typeof fetch,
  client = serviceClient(),
  idempotencyKey?: string,
): ErpDispatchFactoryDeps {
  return {
    serviceClient: client,
    orgId: 'org-1',
    command: { domain: 'budget', operation: 'create', ...(idempotencyKey ? { idempotencyKey } : {}), record } as never,
    fetchImpl,
    apiKey: 'key',
    apiSecret: 'secret',
  };
}

const BINDING = {
  site_url: 'https://erp.example.test',
  version_major: 16,
  activated_at: '2026-01-01T00:00:00Z',
  config: { company: 'Test Co', project_map: { 'pmo-project': 'ERP-PROJ' } },
};
const CONFIG = { category_account_map: [{ category: 'Labor', erp_account: 'Salary' }] };

describe('resolveBudgetRefs whole-project range occupancy', () => {
  it('returns no upsert target for an empty range and probes the full project/account scope', async () => {
    const fetchImpl = erp([]);
    const result = await resolveBudgetRefs(deps(rangeRecord(), fetchImpl), BINDING, CONFIG);

    expect(result.refs).toEqual({ project: 'ERP-PROJ' });
    const request = new URL(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
    expect(JSON.parse(request.searchParams.get('filters') ?? '[]')).toEqual([
      ['company', '=', 'Test Co'], ['project', '=', 'ERP-PROJ'], ['account', '=', 'Salary'], ['docstatus', '<', 2],
    ]);
    expect(JSON.parse(request.searchParams.get('fields') ?? '[]')).toContain('to_fiscal_year');
  });

  it.each([0, 1])('holds when another %s-status ERP budget overlaps the requested range', async (docstatus) => {
    const fetchImpl = erp([candidate('FOREIGN-RANGE', 'FY25', 'FY26', docstatus)]);
    await expect(resolveBudgetRefs(deps(rangeRecord(), fetchImpl), BINDING, CONFIG))
      .rejects.toMatchObject({ code: 'budget-range-occupied' });
  });

  it('allows a valid range that is adjacent to, but does not overlap, another ERP range', async () => {
    const result = await resolveBudgetRefs(
      deps(rangeRecord(), erp([candidate('ADJACENT', 'FY25', 'FY25')])), BINDING, CONFIG,
    );
    expect(result.refs).toEqual({ project: 'ERP-PROJ' });
  });

  it.each([
    ['missing range bound', { ...candidate('BROKEN', 'FY25', 'FY25'), to_fiscal_year: undefined }],
    ['untrusted range bound', candidate('BROKEN', 'FY24', 'FY25')],
  ])('fails closed for an ERP candidate with a %s', async (_label, row) => {
    await expect(resolveBudgetRefs(deps(rangeRecord(), erp([row])), BINDING, CONFIG))
      .rejects.toMatchObject({ code: 'budget-range-ambiguous' });
  });

  it('scans beyond the first full ERP page before declaring a range unoccupied', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => candidate(`ADJ-${String(index).padStart(3, '0')}`, 'FY25', 'FY25'));
    const fetchImpl = erp(rows);
    const result = await resolveBudgetRefs(deps(rangeRecord(), fetchImpl), BINDING, CONFIG);
    expect(result.refs).toEqual({ project: 'ERP-PROJ' });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    const second = new URL(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]));
    expect(JSON.parse(second.searchParams.get('filters') ?? '[]')).toContainEqual(['name', '>', 'ADJ-099']);
  });

  it('allows only the exact draft durably witnessed by this range outbox during recovery', async () => {
    const identity = String(rangeRecord().outbox_identity);
    const key = 'budget-range-recovery';
    const rangeOutbox = {
      org_id: 'org-1', domain: 'budget', pmo_record_id: identity, idempotency_key: key,
      payload_digest: 'digest-1',
      budget_range_operation: {
        stage: 'distribution_put_started', identity, payloadDigest: 'digest-1', mode: 'create',
        draftName: 'ERP-OWN-DRAFT',
      },
    };
    const result = await resolveBudgetRefs(
      deps(rangeRecord(), erp([candidate('ERP-OWN-DRAFT', 'FY26', 'FY26', 0)]), serviceClient({ rangeOutbox }), key),
      BINDING,
      CONFIG,
    );

    expect(result.refs).toEqual({ project: 'ERP-PROJ' });
  });

  it('still holds a witnessed recovery draft when another overlapping ERP budget is also present', async () => {
    const identity = String(rangeRecord().outbox_identity);
    const key = 'budget-range-recovery';
    const rangeOutbox = {
      org_id: 'org-1', domain: 'budget', pmo_record_id: identity, idempotency_key: key,
      payload_digest: 'digest-1',
      budget_range_operation: {
        stage: 'distribution_put_started', identity, payloadDigest: 'digest-1', mode: 'create',
        draftName: 'ERP-OWN-DRAFT',
      },
    };

    await expect(resolveBudgetRefs(
      deps(rangeRecord(), erp([
        candidate('ERP-OWN-DRAFT', 'FY26', 'FY26', 0),
        candidate('ERP-DESK-RIVAL', 'FY26', 'FY27', 1),
      ]), serviceClient({ rangeOutbox }), key),
      BINDING,
      CONFIG,
    )).rejects.toMatchObject({ code: 'budget-range-occupied' });
  });

  it('routes a same-range revision only when its exact identity, mirror, modified stamp, and ERP occupant agree', async () => {
    const predecessor = 'ERP-RANGE-1';
    const predecessorIdentity = budgetRangeIdentity(PREVIOUS_VERSION, 'FY26', 'FY26', 'Salary');
    const mirror = {
      budget_version_id: PREVIOUS_VERSION,
      fiscal_year: 'FY26',
      to_fiscal_year: 'FY26',
      erp_account: 'Salary',
      erp_budget_name: predecessor,
      erp_docstatus: 1,
      erp_cancelled_at: null,
      erp_modified: MODIFIED,
      push_state: 'pushed',
      activated_at_witness: '2026-01-02T00:00:00Z',
      budget_versions: { project_id: 'pmo-project', status: 'Active', activated_at: '2026-01-02T00:00:00Z' },
    };
    const record = rangeRecord({ budget_predecessor: predecessor, budget_predecessor_modified: MODIFIED });
    const result = await resolveBudgetRefs(
      deps(record, erp([candidate(predecessor, 'FY26', 'FY26', 1, MODIFIED)]),
        serviceClient({ sourceIdentity: predecessorIdentity, mirror })),
      BINDING,
      CONFIG,
    );
    expect(result.refs).toEqual({ project: 'ERP-PROJ', self: predecessor });
  });

  it('routes a range account removal only through the exact same-range PMO mirror witness', async () => {
    const predecessor = 'ERP-RANGE-1';
    const predecessorIdentity = budgetRangeIdentity(PREVIOUS_VERSION, 'FY26', 'FY26', 'Salary');
    const mirror = {
      budget_version_id: PREVIOUS_VERSION,
      fiscal_year: 'FY26',
      to_fiscal_year: 'FY26',
      erp_account: 'Salary',
      erp_budget_name: predecessor,
      erp_docstatus: 1,
      erp_cancelled_at: null,
      erp_modified: MODIFIED,
      push_state: 'pushed',
      activated_at_witness: '2026-01-02T00:00:00Z',
      budget_versions: { project_id: 'pmo-project', status: 'Archived', activated_at: '2026-01-02T00:00:00Z' },
    };
    const fetchImpl = erp([]);
    const record = rangeRecord({
      budget_intent: 'remove',
      budget_predecessor: predecessor,
      budget_predecessor_modified: MODIFIED,
    });
    const result = await resolveBudgetRefs(
      deps(record, fetchImpl, serviceClient({ sourceIdentity: predecessorIdentity, mirror })), BINDING, CONFIG,
    );

    expect(result.refs).toEqual({ project: 'ERP-PROJ', self: predecessor });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('holds rather than routing a predecessor whose witnessed modified stamp changed', async () => {
    const predecessor = 'ERP-RANGE-1';
    const mirror = {
      erp_docstatus: 1, erp_cancelled_at: null, erp_modified: '2026-01-05 10:00:00', push_state: 'pushed',
      activated_at_witness: '2026-01-02T00:00:00Z',
      budget_versions: { project_id: 'pmo-project', status: 'Active', activated_at: '2026-01-02T00:00:00Z' },
    };
    const record = rangeRecord({ budget_predecessor: predecessor, budget_predecessor_modified: MODIFIED });
    await expect(resolveBudgetRefs(
      deps(record, erp([candidate(predecessor, 'FY26', 'FY26', 1, MODIFIED)]),
        serviceClient({ sourceIdentity: budgetRangeIdentity(PREVIOUS_VERSION, 'FY26', 'FY26', 'Salary'), mirror })),
      BINDING,
      CONFIG,
    )).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});
