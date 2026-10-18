import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErpClientDeps } from './client.ts';
import type { StatementReportSide } from './statementReports.ts';
import { refreshStatementReportBatch, type StatementReportRefreshInput } from './statementReportRefresh.ts';

const PROFILE = { erpVersion: '16.33.0', frappeVersion: '16.31.0' } as const;
const BATCH = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = '22222222-2222-4222-8222-222222222222';
const HOLDER = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';
const FISCAL_CALENDAR = [
  { name: 'FY-2023', start: '2023-01-01', end: '2023-12-31' },
  { name: 'FY-2024', start: '2024-01-01', end: '2024-12-31' },
];

type RequestKey = {
  statement: 'trial_balance' | 'profit_and_loss' | 'balance_sheet';
  projectId: string | null;
  periodKind: 'month' | 'quarter' | 'fiscal_year';
  currentStart: string;
  currentEnd: string;
  priorStart: string;
  priorEnd: string;
  side: StatementReportSide;
};

const currentRequest: RequestKey = {
  statement: 'trial_balance', projectId: null, periodKind: 'fiscal_year',
  currentStart: '2024-01-01', currentEnd: '2024-12-31',
  priorStart: '2023-01-01', priorEnd: '2023-12-31', side: 'current',
};
const priorRequest: RequestKey = { ...currentRequest, side: 'prior' };

function batch(nextRequest: RequestKey | null, complete = nextRequest === null) {
  return { batchId: BATCH, startedAt: '2026-10-18T10:00:00.000Z', nextRequest, complete };
}
function reportResponse(debit?: string, account = 'Synthetic Cash') {
  return {
    message: {
      columns: [
        { fieldname: 'account', label: 'Account', fieldtype: 'Link' },
        ...['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit']
          .map((fieldname) => ({ fieldname, label: fieldname, fieldtype: 'Currency' })),
      ],
      result: debit === undefined ? [] : [{
        account, opening_debit: '0.00', opening_credit: '0.00', debit,
        credit: '0.00', closing_debit: debit, closing_credit: '0.00',
      }],
    },
  };
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fixture(options: {
  opens?: Array<ReturnType<typeof batch>>;
  stageErrors?: number[];
  publishErrors?: number[];
  admissionError?: boolean;
  admissionDelayMs?: number;
  contextFailure?: boolean;
  languageByMetadataRead?: string[];
  metadataDelayMs?: number;
  reportFetch?: (request: Request, count: number) => Promise<Response> | Response;
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const events: string[] = [];
  const nativeRequests: Request[] = [];
  const staged: Array<Record<string, unknown>> = [];
  const openResults = [...(options.opens ?? [batch(currentRequest), batch(priorRequest), batch(null)])];
  let openCount = 0;
  let stageCount = 0;
  let publishCount = 0;
  let metadataReads = 0;
  let delayed = false;
  let publishedSnapshot: string | null = 'old-complete-generation';
  const client: ErpClientDeps = {
    apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', baseUrl: 'https://erp.example.test',
    maxRetries: 0, timeoutMs: 5_000,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const path = url.pathname;
      events.push(`erp:${path}`);
      if (options.metadataDelayMs && path.startsWith('/api/resource/')) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, options.metadataDelayMs);
          const signal = request.signal;
          const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('aborted', 'AbortError')); };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (path === '/api/method/frappe.utils.change_log.get_versions') {
        if (options.contextFailure) return response({ exc_type: 'Unavailable' }, 503);
        return response({ message: { erpnext: { version: PROFILE.erpVersion }, frappe: { version: PROFILE.frappeVersion } } });
      }
      if (path === '/api/method/frappe.core.doctype.system_settings.system_settings.load') {
        return response({ message: { defaults: { currency_precision: '', float_precision: '', rounding_method: '', number_format: '' } } });
      }
      if (path === '/api/resource/System%20Settings/System%20Settings') {
        const language = options.languageByMetadataRead?.[metadataReads] ?? 'en';
        metadataReads += 1;
        return response({ data: {
          language, currency_precision: '', float_precision: '', rounding_method: '',
          use_number_format_from_currency: 0, number_format: '',
        } });
      }
      if (path === '/api/resource/Language/en' || path === '/api/resource/Language/fr') {
        return response({ data: { name: path.endsWith('/fr') ? 'fr' : 'en', enabled: 1, number_format: '' } });
      }
      if (path === '/api/resource/Company/Synthetic%20Co') {
        return response({ data: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null } });
      }
      if (path === '/api/resource/Accounts%20Settings/Accounts%20Settings') {
        return response({ data: { name: 'Accounts Settings', ignore_is_opening_check_for_reporting: 0, ignore_account_closing_balance: 0 } });
      }
      if (path === '/api/resource/Currency/IDR') {
        return response({ data: { name: 'IDR', fraction_units: 100, number_format: '' } });
      }
      if (path === '/api/resource/Finance%20Book') return response({ data: [] });
      if (path === '/api/resource/Fiscal%20Year') {
        const fields = JSON.parse(url.searchParams.get('fields') ?? '[]') as string[];
        const offset = Number(url.searchParams.get('limit_start') ?? '0');
        if (fields.length === 1 && fields[0] === 'name') {
          return response({ data: FISCAL_CALENDAR.slice(offset, offset + 500).map(({ name }) => ({ name })) });
        }
        const years = FISCAL_CALENDAR.slice(offset, offset + 500).map(({ name, start, end }) => ({
          name, disabled: 0, year_start_date: start, year_end_date: end, companies: [],
        }));
        return response({ data: years });
      }
      if (path.startsWith('/api/resource/Fiscal%20Year/')) {
        const name = decodeURIComponent(path.slice('/api/resource/Fiscal%20Year/'.length));
        const year = FISCAL_CALENDAR.find((entry) => entry.name === name);
        return response({ data: year && { name, disabled: 0, year_start_date: year.start, year_end_date: year.end, companies: [] } });
      }
      if (path === '/api/method/frappe.desk.query_report.run') {
        nativeRequests.push(request);
        return await (options.reportFetch?.(request, nativeRequests.length) ?? response(reportResponse()));
      }
      throw new Error(`unexpected synthetic request ${path}`);
    }) as typeof fetch,
  };
  const service = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args: structuredClone(args) });
      if (name === 'mark_erp_statement_report_refresh_attempt') {
        events.push('attempt');
        if (options.admissionDelayMs) await new Promise((resolve) => setTimeout(resolve, options.admissionDelayMs));
        if (options.admissionError) return { data: null, error: { code: '55000', message: 'lease is not current' } };
        delayed = true;
        return { data: null, error: null };
      }
      if (name === 'open_erp_statement_report_batch') {
        const result = openResults[Math.min(openCount, openResults.length - 1)]!;
        openCount += 1;
        return { data: structuredClone(result), error: null };
      }
      if (name === 'stage_erp_statement_report') {
        stageCount += 1;
        if (options.stageErrors?.includes(stageCount)) return { data: null, error: { code: 'XX001', message: 'raw stage payload must not escape' } };
        staged.push(structuredClone(args.p_report as Record<string, unknown>));
        return { data: null, error: null };
      }
      if (name === 'publish_erp_financial_statements') {
        publishCount += 1;
        if (options.publishErrors?.includes(publishCount)) return { data: null, error: { code: 'XX002', message: 'sensitive publish error' } };
        publishedSnapshot = SNAPSHOT;
        delayed = false;
        return { data: SNAPSHOT, error: null };
      }
      return { data: null, error: { code: '42883', message: 'unexpected RPC' } };
    },
  };
  const input: StatementReportRefreshInput = {
    orgId: ORG,
    holder: HOLDER,
    binding: {
      id: '55555555-5555-4555-8555-555555555555',
      activatedAt: '2026-10-01T00:00:00.000Z',
      versionMajor: 16,
      company: 'Synthetic Co',
      projectMap: { '66666666-6666-4666-8666-666666666666': 'Mapped Project', '77777777-7777-4777-8777-777777777777': 'Second Project' },
    },
    client,
    service,
  };
  return {
    input, rpcCalls, nativeRequests, staged, events,
    counts: () => ({ openCount, stageCount, publishCount, metadataReads }),
    delayed: () => delayed,
    publishedSnapshot: () => publishedSnapshot,
  };
}

describe('refreshStatementReportBatch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('AC-005: uses the fixed RPC contract, actual observed context and only stages the fetched native column/raw text', async () => {
    const h = fixture();
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'published', batchId: BATCH, staged: 2, complete: true, snapshotId: SNAPSHOT });
    expect(h.rpcCalls.map(({ name }) => name)).toEqual([
      'mark_erp_statement_report_refresh_attempt', 'open_erp_statement_report_batch', 'stage_erp_statement_report', 'open_erp_statement_report_batch',
      'stage_erp_statement_report', 'open_erp_statement_report_batch', 'publish_erp_financial_statements',
    ]);
    for (const call of h.rpcCalls) {
      expect(call.args.p_org_id).toBe(ORG);
      expect(call.args.p_holder).toBe(HOLDER);
    }
    expect(h.rpcCalls[0]).toEqual({
      name: 'mark_erp_statement_report_refresh_attempt',
      args: { p_org_id: ORG, p_holder: HOLDER, p_binding: h.input.binding },
    });
    expect(h.events.indexOf('attempt')).toBeLessThan(h.events.findIndex((event) => event.startsWith('erp:')));
    const opens = h.rpcCalls.filter(({ name }) => name === 'open_erp_statement_report_batch');
    expect(opens).toHaveLength(3);
    expect(Object.keys(opens[0]!.args).sort()).toEqual(['p_context', 'p_holder', 'p_org_id']);
    const stages = h.rpcCalls.filter(({ name }) => name === 'stage_erp_statement_report');
    expect(stages.every(({ args }) => args.p_batch_id === BATCH && Object.keys(args).sort().join(',') === 'p_batch_id,p_holder,p_org_id,p_report')).toBe(true);
    const publications = h.rpcCalls.filter(({ name }) => name === 'publish_erp_financial_statements');
    expect(publications).toHaveLength(1);
    expect(publications[0]!.args).toEqual({ p_org_id: ORG, p_holder: HOLDER, p_batch_id: BATCH });
    const context = opens[0]!.args.p_context as Record<string, unknown>;
    expect(Object.keys(context).sort()).toEqual(['binding', 'calendar', 'company', 'filterProfile', 'language', 'presentation', 'profile', 'projectMap']);
    expect(context).toMatchObject({
      binding: { id: h.input.binding.id, activatedAt: h.input.binding.activatedAt, versionMajor: 16 },
      company: 'Synthetic Co',
      profile: PROFILE,
      calendar: FISCAL_CALENDAR,
      projectMap: h.input.binding.projectMap,
      language: 'en',
      filterProfile: 'erpnext-v16-standard-statements-v1',
      presentation: {
        metadata: { currency: 'IDR', currencyPrecision: 2, floatPrecision: 3, roundingMethod: "Banker's Rounding (legacy)" },
        context: { requestLanguage: 'en', raw: { company: { name: 'Synthetic Co', currency: 'IDR' } } },
      },
    });
    const staged = h.staged.map((wrapper) => wrapper as { selection: RequestKey; report: Record<string, unknown>; rawText: string });
    expect(staged.map(({ selection }) => selection)).toEqual([currentRequest, priorRequest]);
    for (const wrapper of staged) {
      expect(Object.keys(wrapper).sort()).toEqual(['rawText', 'report', 'selection']);
      expect(wrapper.report.side).toBe(wrapper.selection.side);
      expect(wrapper.report.reportName).toBe('Trial Balance');
      const expectedYear = wrapper.selection.side === 'current' ? 'FY-2024' : 'FY-2023';
      expect(wrapper.report.period).toMatchObject({ kind: 'year', fromFiscalYear: expectedYear, toFiscalYear: expectedYear });
      expect(wrapper.report.provenance).toMatchObject({ method: 'GET', ignorePreparedReport: 1 });
      expect(wrapper.report.provenance).not.toHaveProperty('responseBody');
      expect(wrapper.rawText).toContain('"columns"');
    }
    expect(h.nativeRequests).toHaveLength(2);
    for (const [index, request] of h.nativeRequests.entries()) {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/api/method/frappe.desk.query_report.run');
      expect([...url.searchParams.keys()].sort()).toEqual(['filters', 'ignore_prepared_report', 'report_name']);
      expect(url.searchParams.get('ignore_prepared_report')).toBe('1');
      expect(url.searchParams.get('report_name')).toBe('Trial Balance');
      const filters = JSON.parse(url.searchParams.get('filters')!) as Record<string, unknown>;
      expect(filters).not.toHaveProperty('ignore_prepared_report');
      expect(filters).toMatchObject({
        company: 'Synthetic Co',
        fiscal_year: index === 0 ? 'FY-2024' : 'FY-2023',
        from_date: index === 0 ? currentRequest.currentStart : currentRequest.priorStart,
        to_date: index === 0 ? currentRequest.currentEnd : currentRequest.priorEnd,
      });
    }
    expect(h.counts()).toEqual({ openCount: 3, stageCount: 2, publishCount: 1, metadataReads: 2 });
    expect(h.delayed()).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic-key');
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });

  it('AC-005: confirmed attempt remains visible when the following native context request fails, with the old publication retained', async () => {
    const h = fixture({ contextFailure: true });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'failed', errorCode: 'native-context-unavailable', complete: false });
    expect(h.rpcCalls.map(({ name }) => name)).toEqual(['mark_erp_statement_report_refresh_attempt']);
    expect(h.events.indexOf('attempt')).toBeLessThan(h.events.findIndex((event) => event.startsWith('erp:')));
    expect(h.nativeRequests).toHaveLength(0);
    expect(h.counts()).toMatchObject({ openCount: 0, stageCount: 0, publishCount: 0 });
    expect(h.publishedSnapshot()).toBe('old-complete-generation');
    expect(h.delayed()).toBe(true);
  });

  it('AC-005: refused admission makes no native, open, stage, or publication call', async () => {
    const h = fixture({ admissionError: true });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'failed', errorCode: 'native-batch-unavailable' });
    expect(h.rpcCalls.map(({ name }) => name)).toEqual(['mark_erp_statement_report_refresh_attempt']);
    expect(h.events.some((event) => event.startsWith('erp:'))).toBe(false);
    expect(h.nativeRequests).toHaveLength(0);
    expect(h.counts()).toMatchObject({ openCount: 0, stageCount: 0, publishCount: 0 });
    expect(h.publishedSnapshot()).toBe('old-complete-generation');
    expect(h.delayed()).toBe(false);
  });

  it('AC-005: an admission response arriving after the fixed segment deadline cannot start ERP work', async () => {
    vi.useFakeTimers();
    const h = fixture({ admissionDelayMs: 8_000 });
    const pending = refreshStatementReportBatch(h.input);

    await vi.advanceTimersByTimeAsync(7_000);
    const result = await pending;
    await vi.advanceTimersByTimeAsync(2_000);

    expect(result).toMatchObject({ status: 'progress', errorCode: 'native-stage-deadline' });
    expect(h.rpcCalls.map(({ name }) => name)).toEqual(['mark_erp_statement_report_refresh_attempt']);
    expect(h.events.some((event) => event.startsWith('erp:'))).toBe(false);
    expect(h.nativeRequests).toHaveLength(0);
    expect(h.counts()).toMatchObject({ openCount: 0, stageCount: 0, publishCount: 0 });
  });

  it('AC-005: reconciles an unknown stage response by indexed open and retries identical bytes only while still missing', async () => {
    const h = fixture({
      stageErrors: [1],
      opens: [batch(currentRequest), batch(currentRequest), batch(priorRequest), batch(null)],
    });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'published', staged: 2, complete: true, snapshotId: SNAPSHOT });
    expect(h.nativeRequests).toHaveLength(2);
    expect(h.staged).toHaveLength(2);
    expect(h.rpcCalls.filter(({ name }) => name === 'stage_erp_statement_report')).toHaveLength(3);
    const firstStage = h.rpcCalls.filter(({ name }) => name === 'stage_erp_statement_report');
    expect(firstStage[0]!.args.p_report).toEqual(firstStage[1]!.args.p_report);
    expect(h.counts().metadataReads).toBe(2);
  });

  it('AC-005: recognizes that an unknown stage succeeded when indexed open advanced, without fetching it twice', async () => {
    const h = fixture({ stageErrors: [1], opens: [batch(currentRequest), batch(priorRequest), batch(null)] });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'published', staged: 2, complete: true, snapshotId: SNAPSHOT });
    expect(h.nativeRequests).toHaveLength(2);
    expect(h.rpcCalls.filter(({ name }) => name === 'stage_erp_statement_report')).toHaveLength(2);
    expect(h.rpcCalls.filter(({ name }) => name === 'open_erp_statement_report_batch')).toHaveLength(3);
  });

  it('AC-005: treats an unknown final-stage advancement as collected work requiring the closing context check', async () => {
    const h = fixture({ stageErrors: [1], opens: [batch(currentRequest), batch(null)] });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'published', staged: 1, complete: true, snapshotId: SNAPSHOT });
    expect(h.nativeRequests).toHaveLength(1);
    expect(h.counts()).toEqual({ openCount: 2, stageCount: 1, publishCount: 1, metadataReads: 2 });
  });

  it('AC-005: rechecks context when the identical stage retry has an unknown outcome but indexed open advances', async () => {
    const h = fixture({ stageErrors: [1, 2], opens: [batch(currentRequest), batch(currentRequest), batch(null)] });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'published', staged: 1, complete: true, snapshotId: SNAPSHOT });
    expect(h.nativeRequests).toHaveLength(1);
    expect(h.counts()).toEqual({ openCount: 3, stageCount: 2, publishCount: 1, metadataReads: 2 });
  });

  it('AC-005: keeps the prior complete generation and never publishes a staged prefix after a later report fails', async () => {
    const rawSentinel = 'NATIVE_RAW_SENTINEL_7319';
    const h = fixture({
      stageErrors: [2, 3],
      opens: [batch(currentRequest), batch(priorRequest), batch(priorRequest)],
      reportFetch: (_request, count) => response(reportResponse(count === 1 ? '10.00' : '20.00', count === 2 ? rawSentinel : undefined)),
    });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'progress', staged: 1, complete: false, errorCode: 'native-stage-outcome-unknown' });
    expect(h.staged).toHaveLength(1);
    expect(h.publishedSnapshot()).toBe('old-complete-generation');
    expect(h.counts().publishCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain('raw stage payload must not escape');
    expect(JSON.stringify(result)).not.toContain(rawSentinel);
  });

  it('AC-005: does not start a second financial pass when each native side returns different captured values', async () => {
    const h = fixture({
      reportFetch: (_request, count) => response(reportResponse(count === 1 ? '10.00' : '20.00')),
    });
    const result = await refreshStatementReportBatch(h.input);

    expect(result.status).toBe('published');
    expect(h.nativeRequests).toHaveLength(2);
    expect(h.staged.map((item) => (item.report as { rows: Array<Record<string, unknown>> }).rows[0]?.debit)).toEqual(['10.00', '20.00']);
    expect(h.counts().metadataReads).toBe(2);
  });

  it('AC-005: publishes an already-complete batch using exactly one fresh native-context read', async () => {
    const h = fixture({ opens: [batch(null)] });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'published', batchId: BATCH, staged: 0, complete: true, snapshotId: SNAPSHOT });
    expect(h.nativeRequests).toHaveLength(0);
    expect(h.counts()).toEqual({ openCount: 1, stageCount: 0, publishCount: 1, metadataReads: 1 });
  });

  it('AC-005: reopens a changed context instead of publishing a batch captured under old metadata', async () => {
    const changed = '88888888-8888-4888-8888-888888888888';
    const h = fixture({
      opens: [batch(currentRequest), batch(priorRequest), batch(null), { ...batch(currentRequest), batchId: changed }],
      languageByMetadataRead: ['en', 'fr'],
    });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'progress', batchId: changed, complete: false });
    expect(h.counts().metadataReads).toBe(2);
    expect(h.nativeRequests).toHaveLength(2);
    expect(h.rpcCalls.some(({ name }) => name === 'publish_erp_financial_statements')).toBe(false);
    const openContexts = h.rpcCalls.filter(({ name }) => name === 'open_erp_statement_report_batch').map(({ args }) => args.p_context);
    expect((openContexts[0] as Record<string, unknown>).language).toBe('en');
    expect((openContexts.at(-1) as Record<string, unknown>).language).toBe('fr');
  });

  it('AC-005: retries unknown publish outcomes idempotently without recollecting reports', async () => {
    const h = fixture({ publishErrors: [1], opens: [batch(null)] });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'published', batchId: BATCH, snapshotId: SNAPSHOT, staged: 0 });
    expect(h.counts()).toEqual({ openCount: 1, stageCount: 0, publishCount: 2, metadataReads: 1 });
    expect(h.nativeRequests).toHaveLength(0);
  });

  it('AC-005: returns safe progress on malformed RPC results and does not expose RPC bodies or errors', async () => {
    const h = fixture({ opens: [{ batchId: 'not-a-uuid', startedAt: 'bad', nextRequest: null, complete: false }] });
    const result = await refreshStatementReportBatch(h.input);
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('bad');
    expect(JSON.stringify(result)).not.toContain('synthetic-key');
    expect(JSON.stringify(result)).not.toContain('authorization');
  });

  it('AC-005: resumes the indexed first-missing request in the next bounded segment without refetching the completed side', async () => {
    vi.useFakeTimers();
    const h = fixture({
      opens: [batch(currentRequest), batch(priorRequest), batch(priorRequest), batch(null)],
      reportFetch: async (_request, count) => {
        if (count === 1) await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        return response(reportResponse(count === 1 ? '10.00' : '20.00'));
      },
    });
    const firstPending = refreshStatementReportBatch(h.input);
    await vi.advanceTimersByTimeAsync(2_000);
    const first = await firstPending;

    expect(first).toMatchObject({ status: 'progress', staged: 1, complete: false, batchId: BATCH });
    expect(h.nativeRequests).toHaveLength(1);
    expect(h.counts().openCount).toBe(2);

    const second = await refreshStatementReportBatch(h.input);
    expect(second).toMatchObject({ status: 'published', staged: 1, complete: true, batchId: BATCH });
    expect(h.nativeRequests).toHaveLength(2);
    expect(h.staged.map((item) => (item.report as { rows: Array<Record<string, unknown>> }).rows[0]?.debit)).toEqual(['10.00', '20.00']);
    expect(h.counts().metadataReads).toBe(3);
  });

  it('AC-005: defers closing-context recheck when the segment has no remaining admission budget, then publishes from one fresh complete context', async () => {
    vi.useFakeTimers();
    const h = fixture({
      opens: [batch(currentRequest), batch(null), batch(null)],
      reportFetch: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 2_500));
        return response(reportResponse('10.00'));
      },
    });
    const firstPending = refreshStatementReportBatch(h.input);
    await vi.advanceTimersByTimeAsync(2_500);
    const first = await firstPending;

    expect(first).toMatchObject({ status: 'progress', staged: 1, complete: true, batchId: BATCH });
    expect(h.counts()).toMatchObject({ openCount: 2, stageCount: 1, publishCount: 0, metadataReads: 1 });
    expect(h.nativeRequests).toHaveLength(1);

    const second = await refreshStatementReportBatch(h.input);
    expect(second).toMatchObject({ status: 'published', staged: 0, complete: true, batchId: BATCH });
    expect(h.counts()).toMatchObject({ openCount: 3, stageCount: 1, publishCount: 1, metadataReads: 2 });
    expect(h.nativeRequests).toHaveLength(1);
  });

  it('AC-005: does not interpret a failed native report response as an empty report or publish it', async () => {
    const h = fixture({ reportFetch: () => response({ message: 'sensitive native failure body' }, 503) });
    const result = await refreshStatementReportBatch(h.input);

    expect(result).toMatchObject({ status: 'failed', staged: 0, complete: false, errorCode: 'native-report-unavailable' });
    expect(h.counts().stageCount).toBe(0);
    expect(h.counts().publishCount).toBe(0);
    expect(h.publishedSnapshot()).toBe('old-complete-generation');
    expect(JSON.stringify(result)).not.toContain('sensitive native failure body');
  });

  it('AC-005: caps the native segment by the remaining whole-sweep tick budget', async () => {
    vi.useFakeTimers();
    const h = fixture({ metadataDelayMs: 4_000 });
    const pending = refreshStatementReportBatch({ ...h.input, remainingTickBudgetMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    const result = await pending;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(result).toMatchObject({ status: 'progress', staged: 0, complete: false, errorCode: 'native-stage-deadline' });
    expect(h.counts().openCount).toBe(0);
    expect(h.counts().stageCount).toBe(0);
    expect(h.nativeRequests).toHaveLength(0);
  });

  it('AC-005: stops the shared stage deadline during cumulative metadata reads', async () => {
    vi.useFakeTimers();
    const h = fixture({ metadataDelayMs: 4_000 });
    const pending = refreshStatementReportBatch(h.input);
    await vi.advanceTimersByTimeAsync(7_001);
    const result = await pending;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(result).toMatchObject({ status: 'progress', staged: 0, complete: false, errorCode: 'native-stage-deadline' });
    expect(h.counts().openCount).toBe(0);
    expect(h.counts().stageCount).toBe(0);
  });

  it('AC-005: does not stage a late ERP response after the per-request abort fires', async () => {
    vi.useFakeTimers();
    let lateResponseResolved = false;
    const h = fixture({
      opens: [batch(currentRequest)],
      reportFetch: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 7_500));
        lateResponseResolved = true;
        return response(reportResponse());
      },
    });
    const pending = refreshStatementReportBatch(h.input);
    await vi.advanceTimersByTimeAsync(7_001);
    const result = await pending;
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(result).toMatchObject({ status: 'progress', batchId: BATCH, staged: 0, complete: false, errorCode: 'native-stage-deadline' });
    expect(lateResponseResolved).toBe(true);
    expect(h.counts().stageCount).toBe(0);
  });
});
