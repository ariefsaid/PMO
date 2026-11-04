import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelOwnedErpBudgets, cleanupBud, ORG_ID, seedBud } from '../../../e2e/serial/_budHelpers';

class FakeQuery {
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  private operation: 'select' | 'insert' | 'upsert' | 'delete' = 'select';
  private payload: unknown;
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];

  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  like(column: string, pattern: string) {
    const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern;
    this.filters.push((row) => typeof row[column] === 'string' && row[column].startsWith(prefix));
    return this;
  }
  contains(column: string, value: Record<string, unknown>) {
    this.filters.push((row) => Object.entries(value).every(([key, expected]) => (row[column] as Record<string, unknown> | undefined)?.[key] === expected));
    return this;
  }
  insert(payload: unknown) { this.operation = 'insert'; this.payload = payload; return this; }
  upsert(payload: unknown) { this.operation = 'upsert'; this.payload = payload; return this; }
  delete() { this.operation = 'delete'; return this; }
  maybeSingle() { return this.execute().then(({ data, error }) => ({ data: data?.[0] ?? null, error })); }
  single() { return this.execute().then(({ data, error }) => ({ data: data?.[0] ?? null, error })); }
  then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) { return this.execute().then(resolve, reject); }

  private async execute(): Promise<QueryResult> {
    const table = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const failureKey = `${this.table}:${this.operation}`;
    const failure = this.db.failures.get(failureKey);
    if (failure) {
      this.db.failures.delete(failureKey);
      return { data: null, error: failure };
    }
    const matches = (row: Record<string, unknown>) => this.filters.every((filter) => filter(row));
    if (this.operation === 'select') return { data: structuredClone(table.filter(matches)), error: null };
    if (this.operation === 'delete') {
      this.db.tables[this.table] = table.filter((row) => !matches(row));
      return { data: null, error: null };
    }
    const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Record<string, unknown>[];
    if (this.operation === 'upsert') {
      for (const row of rows) {
        const index = table.findIndex((existing) => existing.org_id === row.org_id && existing.external_tier === row.external_tier);
        if (index === -1) table.push(structuredClone(row));
        else table[index] = structuredClone(row);
      }
    } else {
      table.push(...structuredClone(rows));
    }
    return { data: structuredClone(rows), error: null };
  }
}

interface QueryResult {
  data: Array<Record<string, unknown>> | null;
  error: { message: string } | null;
}

interface FakeDb {
  tables: Record<string, Array<Record<string, unknown>>>;
  failures: Map<string, { message: string }>;
}

function fakeAdmin(tables: Record<string, Array<Record<string, unknown>>> = {}, failures: Array<[string, { message: string }]> = []) {
  const db: FakeDb = { tables: structuredClone(tables), failures: new Map(failures) };
  return { db, client: { from: (table: string) => new FakeQuery(db, table) } };
}

function priorState() {
  return {
    binding: {
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: 'http://existing-test.invalid',
      secret_ref: 'kept-local-test-binding',
      webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET',
      version_major: 16,
      config: { company: 'Existing TEST Co', project_map: { existing: 'EXISTING-PROJECT' }, marker: 'prior' },
      activated_at: '2026-11-01T00:00:00.000Z',
    },
    categoryMap: [
      { org_id: ORG_ID, category: 'Labor', erp_account: 'Prior Labor - TEST', is_push_target: true },
      { org_id: ORG_ID, category: 'Materials', erp_account: 'Prior Materials - TEST', is_push_target: false },
    ],
  };
}

function seedForCleanup(prior: ReturnType<typeof priorState>) {
  return {
    suffix: 'ac018-unit',
    projectId: '00000000-0000-4000-8000-000000000018',
    erpProject: 'PMO-E2E-BUD-ac018-unit',
    versionIds: ['10000000-0000-4000-8000-000000000018'],
    prior,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('AC-018 budget fixture helper failure paths', () => {
  it('fails closed on a binding snapshot error before any native or local write', async () => {
    const { db, client } = fakeAdmin({}, [['external_org_bindings:select', { message: 'binding snapshot unavailable' }]]);
    const fetch = vi.fn(async () => { throw new Error('unexpected ERP call'); });
    vi.stubGlobal('fetch', fetch);

    await expect(seedBud(client as never, 'ac018-snapshot-error', { projectStart: '2026-01-01', projectEnd: '2027-12-31', versionMajor: 16 }))
      .rejects.toThrow(/external_org_bindings.*snapshot|binding snapshot/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(db.tables.projects ?? []).toEqual([]);
    expect(db.tables.budget_category_account_map ?? []).toEqual([]);
  });

  it('compensates a partial setup and restores exact binding, map, local project, and ERP project state', async () => {
    const prior = priorState();
    const { db, client } = fakeAdmin({
      external_org_bindings: [prior.binding],
      budget_category_account_map: prior.categoryMap,
    }, [['budget_category_account_map:insert', { message: 'fixture map insert rejected' }]]);
    const erpProjectCalls: Array<{ url: string; method: string; body: string | null }> = [];
    let erpProjectExists = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      erpProjectCalls.push({ url: String(input), method: init.method ?? 'GET', body: (init.body as string | undefined) ?? null });
      if ((init.method ?? 'GET') === 'GET') {
        const projects = erpProjectExists ? [{ name: 'PMO-E2E-BUD-ac018-partial', project_name: 'PMO-E2E-BUD-ac018-partial' }] : [];
        return new Response(JSON.stringify({ data: projects }), { status: 200 });
      }
      if ((init.method ?? 'GET') === 'POST') {
        erpProjectExists = true;
        return new Response(JSON.stringify({ data: { name: 'PMO-E2E-BUD-ac018-partial' } }), { status: 200 });
      }
      if (init.method === 'DELETE') {
        erpProjectExists = false;
        return new Response('{}', { status: 200 });
      }
      throw new Error(`unexpected ERP request method ${init.method ?? 'GET'}`);
    }));

    await expect(seedBud(client as never, 'ac018-partial', { projectStart: '2026-01-01', projectEnd: '2027-12-31', versionMajor: 16 }))
      .rejects.toThrow(/fixture map insert rejected/);
    expect(db.tables.external_org_bindings).toEqual([prior.binding]);
    expect(db.tables.budget_category_account_map).toEqual(prior.categoryMap);
    expect(db.tables.projects ?? []).toEqual([]);
    expect(erpProjectCalls.map((call) => call.method)).toEqual(['GET', 'POST', 'GET', 'DELETE', 'GET']);
    expect(erpProjectCalls[1].body).toContain('PMO-E2E-BUD-ac018-partial');
    expect(erpProjectCalls[3].url).toContain('PMO-E2E-BUD-ac018-partial');
  });

  it('reports a scoped delete failure and still restores shared global state', async () => {
    const prior = priorState();
    const versionId = '10000000-0000-4000-8000-000000000018';
    const { db, client } = fakeAdmin({
      budget_versions: [{ id: versionId, org_id: ORG_ID, project_id: '00000000-0000-4000-8000-000000000018' }],
      external_refs: [{ id: 'ref-owned', org_id: ORG_ID, domain: 'budget', pmo_record_id: `${versionId}:FY26` }],
      external_org_bindings: [{ ...prior.binding, site_url: 'http://temporary-test.invalid' }],
      budget_category_account_map: [{ org_id: ORG_ID, category: 'Labor', erp_account: 'Temporary - TEST', is_push_target: true }],
    }, [['external_refs:delete', { message: 'owned reference delete failed' }]]);

    await expect(cleanupBud(client as never, seedForCleanup(prior) as never)).rejects.toThrow(/external_refs.*owned reference delete failed/i);
    expect(db.tables.external_refs).toEqual([{ id: 'ref-owned', org_id: ORG_ID, domain: 'budget', pmo_record_id: `${versionId}:FY26` }]);
    expect(db.tables.external_org_bindings).toEqual([prior.binding]);
    expect(db.tables.budget_category_account_map).toEqual(prior.categoryMap);
  });

  it('attempts every owned submitted cancellation and reports any native document that remains live', async () => {
    const requests: Array<{ method: string; name: string | null; filters: string | null }> = [];
    const docs = [
      { name: 'BUDGET-OWNED-1', docstatus: 1 },
      { name: 'BUDGET-OWNED-2', docstatus: 1 },
      { name: 'BUDGET-FOREIGN', docstatus: 1 },
    ];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      const name = url.pathname.split('/').at(-1) ?? null;
      requests.push({ method, name: method === 'GET' ? null : decodeURIComponent(name ?? ''), filters: url.searchParams.get('filters') });
      if (method === 'GET') return new Response(JSON.stringify({ data: docs.filter((doc) => doc.name !== 'BUDGET-FOREIGN') }), { status: 200 });
      if (method === 'PUT' && name === 'BUDGET-OWNED-1') return new Response('cancellation refused', { status: 409 });
      if (method === 'PUT' && name === 'BUDGET-OWNED-2') {
        const ownDoc = docs.find((doc) => doc.name === name);
        if (ownDoc) ownDoc.docstatus = 2;
        return new Response('{}', { status: 200 });
      }
      return new Response('unexpected ERP request', { status: 500 });
    }));

    await expect(cancelOwnedErpBudgets('PMO-E2E-BUD-ac018-unit')).rejects.toThrow(/BUDGET-OWNED-1.*BUDGET-OWNED-1\(docstatus=1\)/);
    expect(requests).toEqual([
      { method: 'GET', name: null, filters: JSON.stringify([['project', '=', 'PMO-E2E-BUD-ac018-unit']]) },
      { method: 'PUT', name: 'BUDGET-OWNED-1', filters: null },
      { method: 'PUT', name: 'BUDGET-OWNED-2', filters: null },
      { method: 'GET', name: null, filters: JSON.stringify([['project', '=', 'PMO-E2E-BUD-ac018-unit']]) },
    ]);
  });

  it('preserves budget witnesses when native cancellation has not been confirmed', async () => {
    const prior = priorState();
    const versionId = '10000000-0000-4000-8000-000000000018';
    const projectId = '00000000-0000-4000-8000-000000000018';
    const witness = { id: 'ref-owned', org_id: ORG_ID, domain: 'budget', pmo_record_id: `${versionId}:FY26` };
    const version = { id: versionId, org_id: ORG_ID, project_id: projectId };
    const { db, client } = fakeAdmin({
      budget_versions: [version],
      external_refs: [witness],
      external_command_outbox: [{ id: 'outbox-owned', org_id: ORG_ID, domain: 'budget', pmo_record_id: `${versionId}:FY26` }],
      external_org_bindings: [{ ...prior.binding, site_url: 'http://temporary-test.invalid' }],
      budget_category_account_map: [{ org_id: ORG_ID, category: 'Labor', erp_account: 'Temporary - TEST', is_push_target: true }],
    });

    await cleanupBud(client as never, seedForCleanup(prior) as never, { preserveBudgetEvidence: true });
    expect(db.tables.budget_versions).toEqual([version]);
    expect(db.tables.external_refs).toEqual([witness]);
    expect(db.tables.external_command_outbox).toHaveLength(1);
    expect(db.tables.external_org_bindings).toEqual([prior.binding]);
    expect(db.tables.budget_category_account_map).toEqual(prior.categoryMap);
  });
});
