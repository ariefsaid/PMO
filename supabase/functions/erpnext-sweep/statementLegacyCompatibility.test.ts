// Compatibility tests drive the shipped sweep cycle, ERP source feeds, and legacy accounting refreshers.
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const {
  feedOrgLedgersLive, refreshOrgAccountingLive, runErpSweepCycle,
  STATEMENT_SOURCE_READ_REQUEST_TIMEOUT_MS, STATEMENT_SOURCE_READ_STAGE_TIMEOUT_MS,
} = await import('./index.ts');
const { feedLedgerMirrors } = await import('../../../pmo-portal/src/lib/adapterSeam/erpnext/ledgerMirrorFeed.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

type AnyRow = Record<string, unknown>;
type QueryFilter = { column: string; op: 'eq' | 'gt' | 'lt' | 'is'; value: unknown };
type QueryResult = { data: unknown; error: { message: string; code?: string } | null; count?: number };
type Scenario = {
  org: TestOrg;
  metadata?: 'valid' | 'settings-403' | 'usd' | 'missing-opening-field' | 'hang-settings' | 'stage-overrun';
  systemSettings?: '403';
  chart?: 'valid' | 'http-403' | 'invalid-company' | 'hang-account' | 'stage-overrun';
  accountReadAborted?: boolean;
  gl?: 'valid' | 'http-503' | 'ordinary-partial' | 'full-replay-exhaustion';
  ple?: 'valid' | 'incomplete';
  aging?: 'native' | 'report-error';
  finish?: 'success' | 'stale-binding' | 'error';
  missingReferences?: 'computed' | 'always-missing' | 'error-first';
  failDelayedStatus?: boolean;
  seedGl?: AnyRow[];
  seedGlWatermark?: string;
  pleRows?: AnyRow[];
};

type TestOrg = {
  orgId: string;
  siteUrl: string;
  secretRef: string;
  company: string;
  config: Record<string, unknown>;
  ownedDomains: string[];
  versionMajor: number;
  statementReplayNeeded: boolean;
};

type Snapshot = { rows: AnyRow[]; generation: string; asOf: string };
type RecordedRequest = { orgId: string; method: string; path: string; filters: unknown; body: unknown };
type RpcCall = { orgId: string; name: string; args: AnyRow };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  if (stable(actual) !== stable(expected)) throw new Error(`${message}\nexpected ${stable(expected)}\nactual   ${stable(actual)}`);
}
function response(data: unknown, status = 200): Response {
  const body = status === 204 ? null : JSON.stringify(data);
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}
function delayedResponse(init: RequestInit | undefined, res: Response, delayMs = 15): Promise<Response> {
  const signal = init?.signal;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('aborted', 'AbortError')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(res); }, delayMs);
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function orgFor(key: string, versionMajor = 16, replayNeeded = false): TestOrg {
  return {
    orgId: `org-${key}`,
    siteUrl: `https://erp-${key}.synthetic.test`,
    secretRef: `synthetic-ref-${key}`,
    company: `Synthetic ${key}`,
    config: { project_map: { '11111111-1111-4111-8111-111111111111': 'PROJ-SYNTHETIC' }, report_filter_shape: { company: `Synthetic ${key}` } },
    ownedDomains: ['finance'],
    versionMajor,
    statementReplayNeeded: replayNeeded,
  };
}
function glSource(org: TestOrg, over: AnyRow = {}): AnyRow {
  return {
    name: `GL-${org.orgId}`,
    company: org.company,
    account: `5100 - Direct Costs - ${org.company}`,
    cost_center: `Main - ${org.company}`,
    fiscal_year: '2026',
    project: 'PROJ-SYNTHETIC',
    party_type: null,
    party: null,
    voucher_type: 'Purchase Invoice',
    voucher_no: `PINV-${org.orgId}`,
    posting_date: '2026-10-01',
    debit: '1250.75',
    credit: '0.00',
    is_cancelled: false,
    is_opening: 'No',
    finance_book: null,
    docstatus: 1,
    modified: '2026-10-01 10:00:00.000000',
    ...over,
  };
}
function pleSource(org: TestOrg): AnyRow[] {
  return [
    { name: `PLE-AP-${org.orgId}`, account: 'Creditors', party_type: 'Supplier', party: 'Supplier Synthetic A', against_voucher_type: 'Purchase Invoice', against_voucher_no: `PINV-AP-${org.orgId}`, amount: '45000.00', posting_date: '2026-10-01', due_date: '2026-10-15', docstatus: 1, delinked: false, modified: '2026-10-01 10:01:00.000000' },
    { name: `PLE-AR-${org.orgId}`, account: 'Debtors', party_type: 'Customer', party: 'Customer Synthetic B', against_voucher_type: 'Sales Invoice', against_voucher_no: `SINV-AR-${org.orgId}`, amount: '78000.00', posting_date: '2026-10-01', due_date: '2026-10-16', docstatus: 1, delinked: false, modified: '2026-10-01 10:02:00.000000' },
  ];
}
function chartSource(org: TestOrg): AnyRow[] {
  return [
    { name: `Expenses - ${org.company}`, company: org.company, account_name: 'Expenses', root_type: 'Expense', report_type: 'Profit and Loss', parent_account: null, is_group: true, account_number: null, account_currency: 'IDR', lft: 1, rgt: 4, account_type: null, include_in_gross: false, disabled: false, modified: '2026-10-01 09:00:00.000000' },
    { name: `5100 - Direct Costs - ${org.company}`, company: org.company, account_name: 'Direct Costs', root_type: 'Expense', report_type: 'Profit and Loss', parent_account: `Expenses - ${org.company}`, is_group: false, account_number: '5100', account_currency: 'IDR', lft: 2, rgt: 3, account_type: 'Expense Account', include_in_gross: false, disabled: false, modified: '2026-10-01 09:00:00.000000' },
  ];
}
function nativeAgingRows(reportName: string): AnyRow[] {
  return reportName === 'Accounts Payable'
    ? [{ party: 'Supplier Synthetic A', party_type: 'Supplier', currency: 'IDR', outstanding: 45000, current: 15000, range1: 30000, range2: 0, range3: 0, range4: 0, range5: 0 }]
    : [{ party: 'Customer Synthetic B', party_type: 'Customer', currency: 'USD', outstanding: 78000, current: 28000, range1: 50000, range2: 0, range3: 0, range4: 0, range5: 0 }];
}

class MemoryQuery implements PromiseLike<QueryResult> {
  private mode: 'select' | 'update' = 'select';
  private filters: QueryFilter[] = [];
  private orderBy: string | null = null;
  private orderAscending = true;
  private take: number | null = null;
  private updateValues: AnyRow = {};
  constructor(private readonly db: MemoryDatabase, private readonly table: string) {}
  select(_columns: string): this { this.mode = 'select'; return this; }
  update(values: AnyRow): this { this.mode = 'update'; this.updateValues = values; return this; }
  eq(column: string, value: unknown): this { this.filters.push({ column, op: 'eq', value }); return this; }
  gt(column: string, value: unknown): this { this.filters.push({ column, op: 'gt', value }); return this; }
  lt(column: string, value: unknown): this { this.filters.push({ column, op: 'lt', value }); return this; }
  is(column: string, value: unknown): this { this.filters.push({ column, op: 'is', value }); return this; }
  not(column: string, _operator: string, value: unknown): this { this.filters.push({ column, op: 'is', value: value === 'null' ? null : value }); return this; }
  order(column: string, options?: { ascending?: boolean }): this { this.orderBy = column; this.orderAscending = options?.ascending !== false; return this; }
  limit(value: number): this { this.take = value; return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.db.execute(this, true)); }
  upsert(rows: unknown | unknown[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): Promise<QueryResult> {
    return Promise.resolve(this.db.upsert(this.table, Array.isArray(rows) ? rows as AnyRow[] : [rows as AnyRow], options));
  }
  get queryState(): { mode: 'select' | 'update'; filters: QueryFilter[]; orderBy: string | null; orderAscending: boolean; take: number | null; updateValues: AnyRow } {
    return { mode: this.mode, filters: this.filters, orderBy: this.orderBy, orderAscending: this.orderAscending, take: this.take, updateValues: this.updateValues };
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.db.execute(this)).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class MemoryDatabase {
  readonly rows = new Map<string, AnyRow[]>([
    ['erp_gl_entry_mirror', []],
    ['erp_payment_ledger_mirror', []],
    ['external_sync_watermarks', []],
  ]);
  readonly bindings = new Map<string, { org: TestOrg; statement_update_delayed: boolean; statement_calendar: unknown; statementReplayNeeded: boolean }>();
  readonly charts = new Map<string, AnyRow[]>();
  readonly snapshots = new Map<string, Snapshot>();
  readonly snapshotHistory: Array<{ orgId: string; table: string; rows: AnyRow[] }> = [];
  readonly rpcCalls: RpcCall[] = [];
  readonly statusUpdates: Array<{ orgId: string; values: AnyRow }> = [];
  readonly requests: RecordedRequest[] = [];
  readonly cycleEvents: string[] = [];
  private id = 0;
  constructor(readonly scenarios: Scenario[]) {
    for (const scenario of scenarios) {
      this.bindings.set(scenario.org.orgId, { org: scenario.org, statement_update_delayed: true, statement_calendar: [{ start: '2025-01-01', end: '2025-12-31' }], statementReplayNeeded: scenario.org.statementReplayNeeded });
      this.snapshots.set(`${scenario.org.orgId}:erp_actuals_snapshot`, { rows: [{ project_id: 'old-project', net: 999, as_of: '2025-09-01T00:00:00.000Z', source_report: 'GL Entry', snapshot_id: 'old-actuals-generation' }], generation: 'old-actuals-generation', asOf: '2025-09-01T00:00:00.000Z' });
      this.snapshots.set(`${scenario.org.orgId}:erp_ap_aging_snapshot`, { rows: [{ party: 'Old Supplier', total_outstanding: 999, as_of: '2025-09-01T00:00:00.000Z', snapshot_id: 'old-ap-generation' }], generation: 'old-ap-generation', asOf: '2025-09-01T00:00:00.000Z' });
      this.snapshots.set(`${scenario.org.orgId}:erp_ar_aging_snapshot`, { rows: [{ party: 'Old Customer', total_outstanding: 888, as_of: '2025-09-01T00:00:00.000Z', snapshot_id: 'old-ar-generation' }], generation: 'old-ar-generation', asOf: '2025-09-01T00:00:00.000Z' });
      for (const row of scenario.seedGl ?? []) this.insertRow('erp_gl_entry_mirror', { ...row, org_id: scenario.org.orgId });
      if (scenario.seedGlWatermark) this.insertRow('external_sync_watermarks', { org_id: scenario.org.orgId, external_tier: 'erpnext', domain: 'ledger::GL Entry', watermark_cursor: scenario.seedGlWatermark });
    }
  }
  from(table: string): MemoryQuery { return new MemoryQuery(this, table); }
  private matching(table: string, filters: QueryFilter[]): AnyRow[] {
    const rows = table === 'external_org_bindings' ? [...this.bindings.values()].map((binding) => ({ org_id: binding.org.orgId, external_tier: 'erpnext', ...binding })) : (this.rows.get(table) ?? []);
    return rows.filter((row) => filters.every(({ column, op, value }) => {
      const actual = row[column];
      if (op === 'eq' || op === 'is') return actual === value;
      if (op === 'gt') return String(actual ?? '') > String(value ?? '');
      return String(actual ?? '') < String(value ?? '');
    }));
  }
  execute(query: MemoryQuery, single = false): QueryResult {
    const state = query.queryState;
    if (state.mode === 'update') {
      const matches = this.matching((query as unknown as { table: string }).table, state.filters);
      const orgId = String(state.filters.find((f) => f.column === 'org_id')?.value ?? '');
      if ((query as unknown as { table: string }).table === 'external_org_bindings') {
        this.statusUpdates.push({ orgId, values: { ...state.updateValues } });
        const scenario = this.scenarios.find((entry) => entry.org.orgId === orgId);
        if (scenario?.failDelayedStatus && state.updateValues.statement_update_delayed === true) return { data: null, error: { message: 'synthetic status write failure' } };
        const binding = this.bindings.get(orgId);
        if (binding) Object.assign(binding, state.updateValues);
      } else {
        for (const match of matches) Object.assign(match, state.updateValues);
      }
      return { data: null, error: null, count: matches.length };
    }
    let result = this.matching((query as unknown as { table: string }).table, state.filters);
    if (state.orderBy) result = [...result].sort((a, b) => String(a[state.orderBy!] ?? '').localeCompare(String(b[state.orderBy!] ?? '')) * (state.orderAscending ? 1 : -1));
    if (state.take !== null) result = result.slice(0, state.take);
    return { data: single ? result[0] ?? null : result, error: null };
  }
  upsert(table: string, rows: AnyRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): QueryResult {
    const keys = (options?.onConflict ?? 'org_id,erp_name').split(',');
    const tableRows = this.rows.get(table) ?? [];
    const indexByKey = new Map(tableRows.map((current, index) => [keys.map((key) => String(current[key] ?? '')).join('\\u0000'), index]));
    for (const row of rows) {
      const key = keys.map((column) => String(row[column] ?? '')).join('\\u0000');
      const index = indexByKey.get(key);
      if (index !== undefined) {
        if (!options?.ignoreDuplicates) tableRows[index] = { ...tableRows[index], ...row };
      } else {
        this.insertRow(table, row);
        indexByKey.set(key, tableRows.length - 1);
      }
    }
    return { data: null, error: null };
  }
  private insertRow(table: string, row: AnyRow): void {
    const tableRows = this.rows.get(table) ?? [];
    if (!this.rows.has(table)) this.rows.set(table, tableRows);
    this.id += 1;
    tableRows.push({ id: `00000000-0000-4000-8000-${String(this.id).padStart(12, '0')}`, ...row });
  }
  rpc(name: string, args: AnyRow): Promise<QueryResult> {
    return Promise.resolve(this.rpcSync(name, args));
  }
  private rpcSync(name: string, args: AnyRow): QueryResult {
    const orgId = String(args.p_org_id ?? '');
    const scenario = this.scenarios.find((entry) => entry.org.orgId === orgId);
    this.rpcCalls.push({ orgId, name, args: structuredClone(args) });
    if (name === 'replace_erp_account_chart') {
      if (scenario?.chart === 'http-403') return { data: null, error: { message: 'synthetic chart replacement refusal' } };
      this.charts.set(orgId, structuredClone((args.p_rows as AnyRow[]) ?? []));
      return { data: { upserted: (args.p_rows as AnyRow[] | undefined)?.length ?? 0 }, error: null };
    }
    if (name === 'mark_erp_statement_replay_for_missing_accounts') {
      const callNumber = this.rpcCalls.filter((call) => call.orgId === orgId && call.name === name).length;
      if (scenario?.missingReferences === 'error-first' && callNumber === 1) return { data: null, error: { message: 'synthetic reference status unavailable' } };
      const missing = scenario?.missingReferences === 'always-missing' || (scenario?.missingReferences !== 'error-first' && (this.rows.get('erp_gl_entry_mirror') ?? []).some((row) => row.org_id === orgId && row.company === args.p_company && row.is_cancelled !== true && !this.charts.get(orgId)?.some((account) => account.erp_name === row.account)));
      if (missing) {
        const binding = this.bindings.get(orgId);
        if (binding) binding.statementReplayNeeded = true;
      }
      return { data: missing, error: null };
    }
    if (name === 'finish_erp_gl_replay') {
      if (scenario?.finish === 'error') return { data: null, error: { message: 'synthetic finish refusal' } };
      if (scenario?.finish === 'stale-binding') return { data: { deleted: 0, stale_binding: true, replay_id: args.p_replay_id }, error: null };
      const binding = this.bindings.get(orgId);
      if (!binding || binding.org.company !== args.p_company) return { data: { deleted: 0, stale_binding: true }, error: null };
      const ledgerRows = this.rows.get('erp_gl_entry_mirror') ?? [];
      const kept = ledgerRows.filter((row) => row.org_id !== orgId || (row.company === args.p_company && row.replay_seen_id === args.p_replay_id));
      for (const row of kept) if (row.org_id === orgId && row.company === args.p_company) delete row.replay_seen_id;
      this.rows.set('erp_gl_entry_mirror', kept);
      binding.statementReplayNeeded = false;
      if (args.p_watermark !== null) {
        const existing = this.rows.get('external_sync_watermarks') ?? [];
        const watermark = existing.find((row) => row.org_id === orgId && row.domain === 'ledger::GL Entry');
        if (watermark) watermark.watermark_cursor = args.p_watermark;
        else this.insertRow('external_sync_watermarks', { org_id: orgId, external_tier: 'erpnext', domain: 'ledger::GL Entry', watermark_cursor: args.p_watermark });
      }
      return { data: { deleted: 0, replay_id: args.p_replay_id }, error: null };
    }
    if (name === 'replace_erp_snapshot') {
      const table = String(args.p_table);
      const rows = structuredClone((args.p_rows as AnyRow[]) ?? []);
      this.snapshotHistory.push({ orgId, table, rows });
      const generation = String(rows[0]?.snapshot_id ?? 'empty-generation');
      const asOf = String(rows[0]?.as_of ?? new Date().toISOString());
      this.snapshots.set(`${orgId}:${table}`, { rows, generation, asOf });
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unmodeled RPC ${name}` } };
  }
}

function makeHarness(scenarios: Scenario[]) {
  const db = new MemoryDatabase(scenarios);
  const originalFetch = globalThis.fetch;
  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const scenario = scenarios.find((entry) => url.startsWith(entry.org.siteUrl));
    if (!scenario) throw new Error(`Unexpected synthetic ERP URL ${url}`);
    const org = scenario.org;
    const path = url.slice(org.siteUrl.length);
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null;
    let filters: unknown = null;
    const filtersText = parsed.searchParams.get('filters');
    if (filtersText) filters = JSON.parse(filtersText);
    db.requests.push({ orgId: org.orgId, method, path, filters, body });

    if (pathname === '/api/resource/Account') {
      if (scenario.chart === 'http-403') return response({ message: 'synthetic chart read refused' }, 403);
      if (scenario.chart === 'hang-account') {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            scenario.accountReadAborted = true;
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
          } else {
            signal?.addEventListener('abort', () => {
              scenario.accountReadAborted = true;
              reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
            }, { once: true });
          }
        });
      }
      const rows: AnyRow[] = scenario.chart === 'stage-overrun'
        ? Number(parsed.searchParams.get('limit_start') ?? '0') === 0
          ? Array.from({ length: 500 }, (_, index) => ({
              ...chartSource(org)[1]!,
              name: `Synthetic Account ${index} - ${org.company}`,
              account_name: `Synthetic Account ${index}`,
              lft: index + 2,
              rgt: index + 3,
            }))
          : chartSource(org)
        : chartSource(org);
      if (scenario.chart === 'invalid-company') rows[1]!.company = 'Different Synthetic Company';
      const res = response({ data: rows });
      return scenario.chart === 'stage-overrun' ? await delayedResponse(init, res, 4_500) : res;
    }
    if (pathname.startsWith('/api/resource/Company/')) {
      const currency = scenario.metadata === 'usd' ? 'USD' : 'IDR';
      const res = response({ data: { name: org.company, default_currency: currency, default_finance_book: null } });
      return scenario.metadata === 'stage-overrun' ? await delayedResponse(init, res, 4_500) : res;
    }
    if (pathname === '/api/resource/Fiscal Year') {
      const res = response({ data: [{ name: 'FY26', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }] });
      return scenario.metadata === 'stage-overrun' ? await delayedResponse(init, res, 4_500) : res;
    }
    if (pathname.startsWith('/api/resource/Accounts Settings/')) {
      if (scenario.metadata === 'settings-403') return response({ message: 'synthetic settings permission refusal' }, 403);
      if (scenario.metadata === 'hang-settings') {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
          else signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
        });
      }
      const settings: AnyRow = { ignore_account_closing_balance: false };
      if (scenario.metadata !== 'missing-opening-field') settings.ignore_is_opening_check = false;
      const res = response({ data: settings });
      return scenario.metadata === 'stage-overrun' ? await delayedResponse(init, res, 4_500) : res;
    }
    if (pathname.startsWith('/api/resource/System Settings/')) {
      if (scenario.systemSettings === '403') return response({ message: 'synthetic settings permission refusal' }, 403);
      return response({ data: { currency_precision: 2, float_precision: 3, rounding_method: "Banker's Rounding" } });
    }
    if (pathname.startsWith('/api/resource/Currency/')) return response({ data: { name: 'IDR', smallest_currency_fraction_value: 100 } });
    if (pathname === '/api/resource/GL Entry') {
      if (scenario.gl === 'http-503') return response({ exc: 'SyntheticERPUnavailable' }, 503);
      const start = Number(parsed.searchParams.get('limit_start') ?? '0');
      if (scenario.gl === 'full-replay-exhaustion' && start < 300 * 500) return response({ data: pageGl(org, start, 500) });
      if (scenario.gl === 'ordinary-partial' && start < 20 * 500) return response({ data: pageGl(org, start, 500) });
      return response({ data: [glSource(org)] });
    }
    if (pathname === '/api/resource/Payment Ledger Entry') {
      if (scenario.ple === 'incomplete' && Number(parsed.searchParams.get('limit_start') ?? '0') < 20 * 500) return response({ data: pagePle(org, Number(parsed.searchParams.get('limit_start') ?? '0'), 500) });
      return response({ data: scenario.pleRows ?? pleSource(org) });
    }
    if (pathname === '/api/method/frappe.desk.query_report.run') {
      const reportName = String((body as AnyRow | null)?.report_name ?? '');
      if (scenario.aging === 'report-error') return response({ message: 'synthetic report unavailable' }, 403);
      return response({ message: { result: nativeAgingRows(reportName) } });
    }
    throw new Error(`Unexpected synthetic ERP request ${method} ${path}`);
  }) as typeof fetch;
  globalThis.fetch = fetchMock;
  const cache = new Map(scenarios.map(({ org }) => [org.orgId, Promise.resolve({ apiKey: 'synthetic-key', apiSecret: 'synthetic-secret' })]));
  return {
    db,
    cache,
    restore: () => { globalThis.fetch = originalFetch; },
    async runCycle() {
      return await runErpSweepCycle({
        listEmployingOrgs: () => Promise.resolve(scenarios.map(({ org }) => org)),
        claimStatementLock: (orgId) => { db.cycleEvents.push(`claim:${orgId}`); return Promise.resolve(true); },
        releaseStatementLock: (orgId) => { db.cycleEvents.push(`release:${orgId}`); return Promise.resolve(); },
        reconcileOrgOutbox: (org) => { db.cycleEvents.push(`outbox:${org.orgId}`); return Promise.resolve({ reconciled: 0, errors: [] }); },
        sweepOrgDoctypes: (org) => { db.cycleEvents.push(`doctype:${org.orgId}`); return Promise.resolve({ applied: 0 }); },
        repairOrgLinks: (org) => { db.cycleEvents.push(`links:${org.orgId}`); return Promise.resolve({ repaired: 0 }); },
        feedOrgLedgers: (org) => feedOrgLedgersLive(db as unknown as SupabaseClient, org, cache),
        refreshOrgAccounting: (org) => refreshOrgAccountingLive(db as unknown as SupabaseClient, org, cache),
        reconcileOrgBudgetPushes: (org) => { db.cycleEvents.push(`budget:${org.orgId}`); return Promise.resolve({ driven: 0 }); },
        reconcileOrgTimesheetPushes: (org) => { db.cycleEvents.push(`timesheets:${org.orgId}`); return Promise.resolve({ driven: 0 }); },
        reconcileOrgExpensePostings: (org) => { db.cycleEvents.push(`expenses:${org.orgId}`); return Promise.resolve({ driven: 0 }); },
      }, cache);
    },
  };
}
function pageGl(org: TestOrg, offset: number, count: number): AnyRow[] {
  return Array.from({ length: count }, (_, index) => ({ ...glSource(org), name: `GL-PAGE-${offset + index}`, modified: `2026-10-01 10:${String(Math.floor((offset + index) / 60)).padStart(2, '0')}:${String((offset + index) % 60).padStart(2, '0')}.000000` }));
}
function pagePle(org: TestOrg, offset: number, count: number): AnyRow[] {
  return Array.from({ length: count }, (_, index) => ({ ...pleSource(org)[0], name: `PLE-PAGE-${offset + index}` }));
}
function snapshot(db: MemoryDatabase, org: TestOrg, table: string): Snapshot {
  const found = db.snapshots.get(`${org.orgId}:${table}`);
  assert(found, `missing ${table} snapshot for ${org.orgId}`);
  return found;
}
function requestsFor(db: MemoryDatabase, org: TestOrg, doctype: string): RecordedRequest[] {
  return db.requests.filter((entry) => entry.orgId === org.orgId && decodeURIComponent(entry.path.split('?')[0] ?? '') === `/api/resource/${doctype}`);
}
function diagnosticMetadataRequests(db: MemoryDatabase, org: TestOrg): RecordedRequest[] {
  const prefixes = [
    '/api/resource/Company/', '/api/resource/Fiscal Year', '/api/resource/Accounts Settings/',
    '/api/resource/System Settings/', '/api/resource/Currency/',
  ];
  return db.requests.filter((entry) => {
    if (entry.orgId !== org.orgId) return false;
    const path = decodeURIComponent(entry.path.split('?')[0] ?? '');
    return prefixes.some((prefix) => path.startsWith(prefix)) ||
      path === '/api/method/frappe.core.doctype.system_settings.system_settings.load';
  });
}
function noModifiedFilter(request: RecordedRequest): boolean {
  return !Array.isArray(request.filters) || !(request.filters as unknown[][]).some((filter) => filter[0] === 'modified');
}
function assertNativeStatementStateUnchanged(db: MemoryDatabase, org: TestOrg, label: string): void {
  const binding = db.bindings.get(org.orgId);
  assert(binding?.statement_update_delayed === true, `${label}: legacy source feed changed seeded native delayed state`);
  equal(binding?.statement_calendar, [{ start: '2025-01-01', end: '2025-12-31' }], `${label}: legacy source feed changed seeded native calendar`);
  assert(!db.statusUpdates.some((entry) => entry.orgId === org.orgId &&
    ('statement_update_delayed' in entry.values || 'statement_calendar' in entry.values)), `${label}: legacy source feed wrote native status fields`);
}

Deno.test('AC-005: v15 statement metadata denial does not affect the ordinary GL/PLE or accounting feed', async () => {
  const first = orgFor('v15-settings-403', 15, true);
  const second = orgFor('neighbor', 16, false);
  const harness = makeHarness([{ org: first, metadata: 'settings-403', systemSettings: '403' }, { org: second }]);
  try {
    const cycle = await harness.runCycle();
    const firstLedger = cycle.perOrg.find((entry) => entry.orgId === first.orgId)?.ledger as { glCaughtUp?: boolean; pleCaughtUp?: boolean; statementReady?: boolean } | undefined;
    const actuals = snapshot(harness.db, first, 'erp_actuals_snapshot');
    assert(actuals.generation !== 'old-actuals-generation' && actuals.rows.length === 1, `Actuals generation was not replaced with nonempty GL money: ${stable(actuals)}`);
    assert(firstLedger?.glCaughtUp === true && firstLedger.pleCaughtUp === true, `raw feeds did not complete: ${stable(firstLedger)}`);
    assert(firstLedger.statementReady === true, 'unused statement metadata denial blocked otherwise-complete legacy readiness');
    const resultErrors = cycle.perOrg.find((entry) => entry.orgId === first.orgId)?.errors ?? [];
    assert(!resultErrors.some((error) => error.startsWith('statement:')), `unused statement metadata denial became a permanent diagnostic error: ${stable(resultErrors)}`);
    assert(!resultErrors.some((error) => error.startsWith('ledger:')), `metadata denial was misreported as raw failure: ${stable(resultErrors)}`);

    equal(actuals.rows[0], {
      project_id: '11111111-1111-4111-8111-111111111111',
      cost_center: `Main - ${first.company}`,
      account: `5100 - Direct Costs - ${first.company}`,
      fiscal_year: '2026', debit: 1250.75, credit: 0, net: 1250.75,
      as_of: actuals.asOf, source_report: 'GL Entry', snapshot_id: actuals.generation,
    }, 'Actuals snapshot must carry the real mapped GL money and fresh provenance');
    const ap = snapshot(harness.db, first, 'erp_ap_aging_snapshot');
    const ar = snapshot(harness.db, first, 'erp_ar_aging_snapshot');
    assert(ap.generation !== 'old-ap-generation' && ar.generation !== 'old-ar-generation', 'native AP and AR generations were not replaced');
    equal(ap.rows.map(({ snapshot_id: _id, as_of: _asOf, ...row }) => row), [{ party: 'Supplier Synthetic A', party_type: 'Supplier', currency: 'IDR', total_outstanding: 45000, current: 15000, b_0_30: 30000, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: { range1: '0-30', range2: '31-60', range3: '61-90', range4: '91-Above' }, report_date: null, ageing_based_on: null, source_report: 'Accounts Payable', report_version: '15' }], 'AP snapshot payload/provenance mismatch');
    equal(ar.rows.map(({ snapshot_id: _id, as_of: _asOf, ...row }) => row), [{ party: 'Customer Synthetic B', party_type: 'Customer', currency: 'USD', total_outstanding: 78000, current: 28000, b_0_30: 50000, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: { range1: '0-30', range2: '31-60', range3: '61-90', range4: '91-Above' }, report_date: null, ageing_based_on: null, source_report: 'Accounts Receivable', report_version: '15' }], 'AR snapshot payload/provenance mismatch');
    for (const stored of [actuals, ap, ar]) {
      assert(stored.asOf !== '2025-09-01T00:00:00.000Z', 'successful accounting refresh did not advance generation as_of');
      assert(stored.rows.every((row) => row.snapshot_id === stored.generation && row.as_of === stored.asOf), 'snapshot generation/provenance is not internally atomic');
    }
    assertNativeStatementStateUnchanged(harness.db, first, 'v15 metadata denial');
    assert(diagnosticMetadataRequests(harness.db, first).length === 0, 'ordinary v15 feed requested native statement metadata');
    const initialFinish = harness.db.rpcCalls.find((call) => call.orgId === first.orgId && call.name === 'finish_erp_gl_replay');
    assert(initialFinish && initialFinish.args.p_company === first.company && typeof initialFinish.args.p_replay_id === 'string' && initialFinish.args.p_watermark === '2026-10-01 10:00:00.000000', `initial replay completion arguments were not preserved: ${stable(initialFinish)}`);
    assert(harness.db.rpcCalls.filter((call) => call.orgId === first.orgId && call.name === 'finish_erp_gl_replay').length === 1, 'the migrated initial replay must finish exactly once');
    assert(requestsFor(harness.db, first, 'GL Entry').length === 1 && requestsFor(harness.db, first, 'Payment Ledger Entry').length === 1, 'raw feed did not execute exactly once for the initial cycle');
    assert(noModifiedFilter(requestsFor(harness.db, first, 'GL Entry')[0]!), 'initial pending replay must fetch all GL history without a modified filter');
    assert(harness.db.bindings.get(first.orgId)?.statementReplayNeeded === false, 'a genuinely completed raw replay may clear historical replay-needed despite statement delay');

    const next = { ...first, statementReplayNeeded: false };
    const retryCache = new Map([[first.orgId, Promise.resolve({ apiKey: 'synthetic-key', apiSecret: 'synthetic-secret' })]]);
    const retry = await feedOrgLedgersLive(harness.db as unknown as SupabaseClient, next, retryCache) as { glCaughtUp?: boolean; pleCaughtUp?: boolean; statementReady?: boolean };
    assert(retry.glCaughtUp === true && retry.pleCaughtUp === true && retry.statementReady === true, `later ordinary feed did not stay separate from unused metadata: ${stable(retry)}`);
    const glRequests = requestsFor(harness.db, first, 'GL Entry');
    assert(glRequests.length === 2 && !noModifiedFilter(glRequests[1]!), 'an unused metadata denial must not repeat a full replay on the next tick');
    assert(harness.db.rpcCalls.filter((call) => call.orgId === first.orgId && call.name === 'finish_erp_gl_replay').length === 1, 'metadata denial caused a duplicate replay completion');
    assert(diagnosticMetadataRequests(harness.db, first).length === 0, 'ordinary retry requested native statement metadata');

    assert(cycle.perOrg.length === 2 && cycle.perOrg[1]?.orgId === second.orgId, 'later org did not run after statement-only failure');
    assert(harness.db.cycleEvents.includes(`expenses:${second.orgId}`), 'later org backstops did not finish');
    assert(harness.db.cycleEvents.includes(`release:${first.orgId}`) && harness.db.cycleEvents.includes(`release:${second.orgId}`), 'sweep lock was not released in finally for both orgs');
    assert(!harness.cache.has(first.orgId) && !harness.cache.has(second.orgId), 'per-org auth cache entries were not cleared');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: unused v16 statement metadata does not affect real chart and raw accounting refreshes', async () => {
  for (const [key, metadata] of [
    ['v16-usd', 'usd'],
    ['v16-missing-field', 'missing-opening-field'],
  ] as const) {
    const org = orgFor(key, 16, false);
    const harness = makeHarness([{ org, metadata, systemSettings: '403' }]);
    try {
      const cycle = await harness.runCycle();
      const errors = cycle.perOrg[0]?.errors ?? [];
      assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, `${key}: real project Actuals were not published`);
      assert(cycle.perOrg[0]?.ledger?.statementReady === true, `${key}: unused native metadata prevented ordinary chart readiness`);
      assert(!errors.some((error) => error.startsWith('statement:')), `${key}: unused native metadata became an ordinary-feed error: ${stable(errors)}`);
      assert(!errors.some((error) => error.startsWith('ledger:')), `valid raw feed was blocked for ${key}: ${stable(errors)}`);
      assert(snapshot(harness.db, org, 'erp_ap_aging_snapshot').rows[0]?.total_outstanding === 45000, `${key}: real AP snapshot was not published`);
      assert(snapshot(harness.db, org, 'erp_ar_aging_snapshot').rows[0]?.total_outstanding === 78000, `${key}: real AR snapshot was not published`);
      assertNativeStatementStateUnchanged(harness.db, org, key);
      assert(diagnosticMetadataRequests(harness.db, org).length === 0, `${key}: ordinary feed requested native statement metadata`);
    } finally {
      harness.restore();
    }
  }
});

Deno.test('AC-005: valid chart and complete raw history retain diagnostic readiness without native publication', async () => {
  const org = orgFor('valid-statement', 16, true);
  const harness = makeHarness([{ org }]);
  try {
    const cycle = await harness.runCycle();
    const entry = cycle.perOrg[0]!;
    assert(entry.ledger?.statementReady === true, `complete raw/chart sources did not remain diagnostically ready: ${stable(entry)}`);
    assertNativeStatementStateUnchanged(harness.db, org, 'complete raw/chart source feed');
    assert(!harness.db.rpcCalls.some((call) => call.orgId === org.orgId && ['open_erp_statement_report_batch', 'stage_erp_statement_report', 'publish_erp_financial_statements'].includes(call.name)), 'legacy chart readiness invoked native publication');
    const sourceOrder = harness.db.requests.filter((request) => request.orgId === org.orgId && (decodeURIComponent(request.path.split('?')[0] ?? '') === '/api/resource/Account' || decodeURIComponent(request.path.split('?')[0] ?? '') === '/api/resource/GL Entry'))
      .map((request) => decodeURIComponent(request.path.split('?')[0] ?? '') === '/api/resource/Account' ? 'chart' : 'ledger');
    equal(sourceOrder, ['chart', 'ledger'], 'chart must be read before the raw ledger feed');
    assert(harness.db.rpcCalls.some((call) => call.orgId === org.orgId && call.name === 'finish_erp_gl_replay' && call.args.p_company === org.company && call.args.p_watermark === '2026-10-01 10:00:00.000000'), 'full raw replay completion arguments changed');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: aging report failures preserve legacy refresh and use real Payment Ledger fallback', async () => {
  const org = orgFor('fallback-aging', 16, false);
  const sourcePle = [
    { ...pleSource(org)[0], amount: '125000.50', due_date: daysAgo(45) },
    { ...pleSource(org)[1], amount: '260000.25', due_date: daysAgo(100) },
  ];
  const harness = makeHarness([{ org, metadata: 'settings-403', systemSettings: '403', aging: 'report-error', pleRows: sourcePle }]);
  try {
    const cycle = await harness.runCycle();
    assert(cycle.perOrg[0]?.ledger?.glCaughtUp === true && cycle.perOrg[0]?.ledger?.pleCaughtUp === true, 'raw GL/PLE did not complete alongside statement/report errors');
    const ap = snapshot(harness.db, org, 'erp_ap_aging_snapshot');
    const ar = snapshot(harness.db, org, 'erp_ar_aging_snapshot');
    const fallbackAp = ap.rows.find((row) => row.party === 'Supplier Synthetic A');
    const fallbackAr = ar.rows.find((row) => row.party === 'Customer Synthetic B');
    assert(fallbackAp?.source_report === 'Accounts Payable (mirrored-ledger fallback)' && fallbackAp.total_outstanding === 125000.5 && fallbackAp.b_31_60 === 125000.5, `AP fallback did not bucket the real mirrored PLE amount: ${stable(ap.rows)}`);
    assert(fallbackAr?.source_report === 'Accounts Receivable (mirrored-ledger fallback)' && fallbackAr.total_outstanding === 260000.25 && fallbackAr.b_90_plus === 260000.25, `AR fallback did not bucket the real mirrored PLE amount: ${stable(ar.rows)}`);
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, 'statement/report-only failure prevented real Actuals refresh');
    assert(!cycle.perOrg[0]?.errors.some((error) => error.startsWith('statement:')), 'unused statement metadata surfaced as an ordinary-feed error');
    assert(diagnosticMetadataRequests(harness.db, org).length === 0, 'ordinary aging fallback requested native statement metadata');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: invalid chart does not downgrade an initial full replay or certify statement readiness', async () => {
  const org = orgFor('invalid-chart-replay', 16, true);
  const harness = makeHarness([{ org, chart: 'invalid-company' }]);
  try {
    const cycle = await harness.runCycle();
    const entry = cycle.perOrg[0]!;
    assert(entry.ledger?.glCaughtUp === true && entry.ledger.pleCaughtUp === true, `invalid chart blocked raw replay: ${stable(entry)}`);
    assert(entry.ledger.statementReady === false && entry.errors.some((error) => error.startsWith('statement:')), 'invalid chart was reported as statement-ready');
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, 'invalid chart prevented legacy Actuals');
    assert(snapshot(harness.db, org, 'erp_ap_aging_snapshot').rows[0]?.total_outstanding === 45000, 'invalid chart prevented legacy AP refresh');
    assert(snapshot(harness.db, org, 'erp_ar_aging_snapshot').rows[0]?.total_outstanding === 78000, 'invalid chart prevented legacy AR refresh');
    assert(!harness.db.rpcCalls.some((call) => call.orgId === org.orgId && call.name === 'replace_erp_account_chart'), 'invalid chart was falsely replaced');
    assert(!harness.db.rpcCalls.some((call) => call.orgId === org.orgId && call.name === 'mark_erp_statement_replay_for_missing_accounts'), 'references were evaluated against an invalid chart');
    assert(harness.db.rpcCalls.filter((call) => call.orgId === org.orgId && call.name === 'finish_erp_gl_replay').length === 1, 'initial full replay was not safely finished exactly once');
    assert(noModifiedFilter(requestsFor(harness.db, org, 'GL Entry')[0]!), 'chart failure downgraded initial history to an incremental GL query');
    assert(harness.db.bindings.get(org.orgId)?.statementReplayNeeded === false, 'complete raw history did not clear its historical replay flag');
    assertNativeStatementStateUnchanged(harness.db, org, 'invalid chart');
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').generation !== 'old-actuals-generation', 'raw replay did not advance the actuals generation');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: unresolved chart references reassert replay without pretending unknown is resolved', async () => {
  const org = orgFor('missing-reference', 16, false);
  const prior = { ...glSource(org), name: undefined, erp_name: 'GL-UNKNOWN-ACCOUNT', account: 'Unknown - Not In Chart', debit: '50.00', erp_modified: '2026-09-30 10:00:00.000000', modified: '2026-09-30 10:00:00.000000' };
  const harness = makeHarness([{ org, missingReferences: 'computed', seedGl: [prior], seedGlWatermark: '2026-09-30 10:00:00.000000' }]);
  try {
    const cycle = await harness.runCycle();
    const entry = cycle.perOrg[0]!;
    assert(entry.ledger?.glCaughtUp === true && entry.ledger.pleCaughtUp === true, 'unresolved references blocked complete raw accounting feeds');
    assert(entry.ledger.statementReady === false, 'missing reference was reported as resolved');
    assert(harness.db.bindings.get(org.orgId)?.statementReplayNeeded === true, 'missing reference did not schedule a repair replay');
    assert(!harness.db.rpcCalls.some((call) => call.orgId === org.orgId && call.name === 'finish_erp_gl_replay'), 'a newly discovered missing reference forced a same-tick replay');
    assert(!noModifiedFilter(requestsFor(harness.db, org, 'GL Entry')[0]!), 'missing-reference detection discarded the original incremental feed mode');
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows.length > 0, 'unresolved references prevented legacy Actuals refresh');
    assertNativeStatementStateUnchanged(harness.db, org, 'unresolved chart references');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: chart-reference errors stay independent and legacy status writes cannot affect raw accounting', async () => {
  for (const key of ['reference-rpc-error', 'delayed-status-error']) {
    const org = orgFor(key, 16, true);
    const scenario: Scenario = { org, missingReferences: key === 'reference-rpc-error' ? 'error-first' : 'computed', failDelayedStatus: key === 'delayed-status-error' };
    const harness = makeHarness([scenario]);
    try {
      const cycle = await harness.runCycle();
      assert(cycle.perOrg[0]?.ledger?.glCaughtUp === true && cycle.perOrg[0]?.ledger.pleCaughtUp === true, `${key} prevented raw history completion`);
      if (key === 'reference-rpc-error') {
        assert(cycle.perOrg[0]?.ledger.statementReady === false && cycle.perOrg[0]?.errors.some((error) => error.startsWith('statement:')), `${key} did not retain its independent reference-check failure`);
      } else {
        assert(cycle.perOrg[0]?.ledger.statementReady === true, `${key}: an obsolete native status-write fault affected the raw/chart diagnostic`);
        assert(!cycle.perOrg[0]?.errors.some((error) => error.startsWith('statement:')), `${key}: a removed native status write still affected the legacy feed`);
      }
      assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, `${key} prevented legacy Actuals refresh`);
      assertNativeStatementStateUnchanged(harness.db, org, key);
    } finally {
      harness.restore();
    }
  }
});

Deno.test('AC-005: raw partial GL and incomplete Payment Ledger retain prior accounting generations', async () => {
  const partialGl = orgFor('partial-gl', 16, false);
  const incompletePle = orgFor('incomplete-ple', 16, false);
  const harness = makeHarness([{ org: partialGl, gl: 'ordinary-partial' }, { org: incompletePle, ple: 'incomplete' }]);
  try {
    const cycle = await harness.runCycle();
    for (const org of [partialGl, incompletePle]) {
      const entry = cycle.perOrg.find((record) => record.orgId === org.orgId)!;
      assert(entry.ledger?.statementReady === false, `${org.orgId}: incomplete raw data was marked statement-ready`);
      assert(entry.errors.some((error) => error.startsWith('ledger:')), `${org.orgId}: raw incompleteness was not recorded`);
      if (org === partialGl) assert(entry.ledger?.glCaughtUp === false && entry.ledger.pleCaughtUp === true, 'partial GL result flags do not describe raw completion');
      if (org === incompletePle) assert(entry.ledger?.glCaughtUp === true && entry.ledger.pleCaughtUp === false, 'incomplete PLE result flags do not describe raw completion');
      assert(snapshot(harness.db, org, 'erp_actuals_snapshot').generation === 'old-actuals-generation' && snapshot(harness.db, org, 'erp_actuals_snapshot').asOf === '2025-09-01T00:00:00.000Z', `${org.orgId}: partial feed replaced the old Actuals generation/time`);
      assert(snapshot(harness.db, org, 'erp_ap_aging_snapshot').generation === 'old-ap-generation' && snapshot(harness.db, org, 'erp_ap_aging_snapshot').asOf === '2025-09-01T00:00:00.000Z', `${org.orgId}: partial feed replaced the old AP generation/time`);
      assert(snapshot(harness.db, org, 'erp_ar_aging_snapshot').generation === 'old-ar-generation' && snapshot(harness.db, org, 'erp_ar_aging_snapshot').asOf === '2025-09-01T00:00:00.000Z', `${org.orgId}: partial feed replaced the old AR generation/time`);
      assertNativeStatementStateUnchanged(harness.db, org, 'incomplete raw feed');
    }
    assert(harness.db.snapshotHistory.length === 0, 'incomplete raw feeds wrote one or more accounting snapshots');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: ordinary and pending raw GL outages report HTTP 503 and preserve all old snapshots', async () => {
  const ordinary = orgFor('ordinary-gl-503', 16, false);
  const pending = orgFor('pending-gl-503', 16, true);
  const harness = makeHarness([{ org: ordinary, gl: 'http-503' }, { org: pending, gl: 'http-503' }]);
  try {
    const cycle = await harness.runCycle();
    for (const org of [ordinary, pending]) {
      const entry = cycle.perOrg.find((record) => record.orgId === org.orgId)!;
      assert(entry.errors.some((error) => error.startsWith('ledger:') && /status 503/i.test(error)), `${org.orgId}: real GL HTTP 503 was not preserved: ${stable(entry.errors)}`);
      assert(!entry.errors.some((error) => /TypeError|maybeSingle/i.test(error)), `${org.orgId}: fixture failure hid the upstream 503`);
      assert(requestsFor(harness.db, org, 'GL Entry').length === 4, `${org.orgId}: expected the shipped ordinary-client 503 attempts`);
      assert(snapshot(harness.db, org, 'erp_actuals_snapshot').generation === 'old-actuals-generation', `${org.orgId}: GL outage replaced Actuals`);
      assert(snapshot(harness.db, org, 'erp_ap_aging_snapshot').generation === 'old-ap-generation' && snapshot(harness.db, org, 'erp_ar_aging_snapshot').generation === 'old-ar-generation', `${org.orgId}: GL outage replaced aging snapshots`);
      assert(!harness.db.rpcCalls.some((call) => call.orgId === org.orgId && call.name === 'finish_erp_gl_replay'), `${org.orgId}: failed raw fetch reached replay completion`);
    }
    assert(harness.db.cycleEvents.includes(`expenses:${pending.orgId}`), 'a pending raw outage blocked later backstops');
    assert(cycle.perOrg.length === 2 && cycle.perOrg[1]?.orgId === pending.orgId, 'an ordinary outage blocked the later org');
    assert(harness.db.cycleEvents.includes(`release:${ordinary.orgId}`) && harness.db.cycleEvents.includes(`release:${pending.orgId}`), 'raw failure skipped lock release');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: stale-binding finish refusal keeps replay pending and skips PLE/accounting continuation', async () => {
  const org = orgFor('stale-finish', 16, true);
  const nextOrg = orgFor('stale-finish-neighbor', 16, false);
  const harness = makeHarness([{ org, finish: 'stale-binding', seedGlWatermark: '2026-09-30 10:00:00.000000' }, { org: nextOrg }]);
  try {
    const cycle = await harness.runCycle();
    const entry = cycle.perOrg[0]!;
    assert(entry.errors.some((error) => error.startsWith('ledger:') && /stale.*binding/i.test(error)), `stale-binding refusal was not a raw error: ${stable(entry.errors)}`);
    assert(entry.ledger?.glCaughtUp === false && entry.ledger.pleCaughtUp === false, 'stale-binding refusal returned caught-up flags');
    assert(requestsFor(harness.db, org, 'Payment Ledger Entry').length === 0, 'stale-binding refusal continued into PLE fetch');
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').generation === 'old-actuals-generation' && snapshot(harness.db, org, 'erp_actuals_snapshot').asOf === '2025-09-01T00:00:00.000Z', 'stale-binding refusal published Actuals or advanced its time');
    assert(snapshot(harness.db, org, 'erp_ap_aging_snapshot').generation === 'old-ap-generation' && snapshot(harness.db, org, 'erp_ap_aging_snapshot').asOf === '2025-09-01T00:00:00.000Z' && snapshot(harness.db, org, 'erp_ar_aging_snapshot').generation === 'old-ar-generation' && snapshot(harness.db, org, 'erp_ar_aging_snapshot').asOf === '2025-09-01T00:00:00.000Z', 'stale-binding refusal published aging or advanced its time');
    assert(harness.db.bindings.get(org.orgId)?.statementReplayNeeded === true, 'stale-binding refusal cleared pending replay');
    assert(harness.db.rows.get('external_sync_watermarks')?.find((row) => row.org_id === org.orgId && row.domain === 'ledger::GL Entry')?.watermark_cursor === '2026-09-30 10:00:00.000000', 'stale-binding refusal promoted the GL watermark');
    assert(cycle.perOrg.length === 2 && cycle.perOrg[1]?.orgId === nextOrg.orgId, 'stale-binding refusal blocked the next org');
    assert(harness.db.cycleEvents.includes(`expenses:${org.orgId}`) && harness.db.cycleEvents.includes(`expenses:${nextOrg.orgId}`), 'stale-binding refusal blocked later backstops');
    assert(harness.db.cycleEvents.includes(`release:${org.orgId}`) && harness.db.cycleEvents.includes(`release:${nextOrg.orgId}`), 'stale-binding refusal skipped finally lock release');
    assert(snapshot(harness.db, nextOrg, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, 'next org legacy accounting did not run after stale-binding refusal');
    assert(!harness.cache.has(org.orgId) && !harness.cache.has(nextOrg.orgId), 'stale-binding cycle did not clear per-org auth cache entries');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: full replay page exhaustion fetches all allowed pages before any GL mutation', async () => {
  const org = orgFor('page-exhaustion', 16, true);
  const existing = { ...glSource(org), name: undefined, erp_name: 'GL-OLD', debit: '20.00', erp_modified: '2026-09-01 10:00:00.000000', modified: '2026-09-01 10:00:00.000000' };
  const harness = makeHarness([{ org, gl: 'full-replay-exhaustion', seedGl: [existing], seedGlWatermark: '2026-09-01 10:00:00.000000' }]);
  try {
    let rejected = false;
    try {
      await feedLedgerMirrors(harness.db as unknown as Parameters<typeof feedLedgerMirrors>[0], { client: { fetchImpl: globalThis.fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', baseUrl: org.siteUrl }, orgId: org.orgId, company: org.company, fullReplay: true, maxPages: 1 });
    } catch (error) {
      rejected = true;
      assert((error as Error).message.includes('page budget exhausted'), `unexpected replay exhaustion error: ${String(error)}`);
    }
    assert(rejected, 'a full replay that ended on a full page was accepted');
    assert(harness.db.rows.get('erp_gl_entry_mirror')?.length === 1 && harness.db.rows.get('erp_gl_entry_mirror')?.[0]?.erp_name === 'GL-OLD', `incomplete history mutated the existing GL mirror: ${stable(harness.db.rows.get('erp_gl_entry_mirror'))}`);
    assert(harness.db.rows.get('external_sync_watermarks')?.find((row) => row.org_id === org.orgId && row.domain === 'ledger::GL Entry')?.watermark_cursor === '2026-09-01 10:00:00.000000', 'incomplete history promoted the GL watermark');
    assert(noModifiedFilter(requestsFor(harness.db, org, 'GL Entry')[0]!), 'full replay page exhaustion used an incremental modified filter');
    assert(harness.db.rpcCalls.length === 0, 'incomplete history reached finish or another write RPC');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: a hung readable Account request is aborted at its per-request bound before legacy accounting', async () => {
  const org = orgFor('hung-account', 16, false);
  const scenario: Scenario = { org, chart: 'hang-account' };
  const harness = makeHarness([scenario]);
  try {
    const startedAt = Date.now();
    const cycle = await harness.runCycle();
    const elapsedMs = Date.now() - startedAt;
    const entry = cycle.perOrg[0]!;
    assert(scenario.accountReadAborted === true, 'hung Account request was not aborted by its configured request bound');
    assert(elapsedMs < STATEMENT_SOURCE_READ_REQUEST_TIMEOUT_MS + 1_500,
      `per-request Account timeout exceeded its 5000ms bound plus tolerance (${elapsedMs}ms)`);
    assert(entry.ledger?.glCaughtUp === true && entry.ledger.pleCaughtUp === true, 'hung Account read prevented real raw feeds');
    assert(entry.ledger.statementReady === false && entry.errors.some((error) => error.startsWith('statement:')), 'unavailable chart was certified ready');
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, 'hung Account read prevented Actuals refresh from mirrored GL');
    assert(requestsFor(harness.db, org, 'Account').length === 1, 'ordinary feed did not perform the actual Account source read');
    assert(requestsFor(harness.db, org, 'GL Entry').length > 0 && requestsFor(harness.db, org, 'Payment Ledger Entry').length > 0, 'raw feeds were not reached after the hung Account read');
    assert(diagnosticMetadataRequests(harness.db, org).length === 0, 'ordinary feed requested native statement metadata while recovering from the Account timeout');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: the whole statement-read stage deadline bounds cumulative reads and still reaches raw accounting', async () => {
  const org = orgFor('stage-deadline', 16, false);
  const harness = makeHarness([{ org, chart: 'stage-overrun' }]);
  try {
    const cycle = await harness.runCycle();
    const entry = cycle.perOrg[0]!;
    assert(entry.ledger?.glCaughtUp === true && entry.ledger.pleCaughtUp === true, 'statement-stage deadline blocked raw feeds');
    assert(entry.ledger.statementReady === false && entry.errors.some((error) => error.startsWith('statement:') && error.includes(`${STATEMENT_SOURCE_READ_STAGE_TIMEOUT_MS}ms`)), 'cumulative statement-read stage did not hit its whole-stage deadline');
    assert(requestsFor(harness.db, org, 'Account').length === 2, 'cumulative source budget did not cross multiple real Account pages');
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, 'whole-stage deadline prevented actuals refresh');
    assert(requestsFor(harness.db, org, 'GL Entry').length === 1 && requestsFor(harness.db, org, 'Payment Ledger Entry').length === 1, 'raw source requests did not continue after the statement-stage deadline');
    assert(diagnosticMetadataRequests(harness.db, org).length === 0, 'ordinary feed requested native statement metadata while enforcing the source-stage budget');
  } finally {
    harness.restore();
  }
});

Deno.test('AC-005: a System Settings 403 is not read or surfaced by the ordinary ledger feed', async () => {
  const org = orgFor('least-privilege-settings', 16, true);
  const harness = makeHarness([{ org, systemSettings: '403' }]);
  try {
    const cycle = await harness.runCycle();
    const entry = cycle.perOrg[0]!;
    const settingsRequests = harness.db.requests.filter((request) =>
      decodeURIComponent(request.path.split('?')[0] ?? '').startsWith('/api/resource/System Settings/'));

    assert(settingsRequests.length === 0, `ordinary ledger feed requested System Settings: ${stable(settingsRequests)}`);
    assert(entry.ledger?.glCaughtUp === true && entry.ledger?.pleCaughtUp === true, `raw GL/PLE did not complete: ${stable(entry.ledger)}`);
    assert(!entry.errors.some((error) => error.startsWith('statement:')), `System Settings affected ordinary feed status: ${stable(entry.errors)}`);
    assert(snapshot(harness.db, org, 'erp_actuals_snapshot').rows[0]?.net === 1250.75, 'System Settings availability prevented real Actuals refresh');
    assert(snapshot(harness.db, org, 'erp_ap_aging_snapshot').rows[0]?.total_outstanding === 45000, 'System Settings availability prevented real AP refresh');
    assert(snapshot(harness.db, org, 'erp_ar_aging_snapshot').rows[0]?.total_outstanding === 78000, 'System Settings availability prevented real AR refresh');
    assertNativeStatementStateUnchanged(harness.db, org, 'ordinary feed with restricted System Settings access');
    assert(harness.db.rpcCalls.some((call) => call.orgId === org.orgId && call.name === 'finish_erp_gl_replay'), 'removing diagnostic metadata changed full replay completion');
  } finally {
    harness.restore();
  }
});
