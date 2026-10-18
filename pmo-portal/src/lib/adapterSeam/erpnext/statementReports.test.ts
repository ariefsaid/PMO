import { describe, expect, it, vi } from 'vitest';
import type { ErpClientDeps } from './client.ts';
import {
  fetchStatementReport,
  joinStatementReportPair,
  parseStatementReport,
  projectStatementTotals,
  type StatementReportContext,
  type StatementReportPeriod,
  type StatementReportSelection,
} from './statementReports.ts';

const NUMBER = '__JSON_NUMBER__';
const numberToken = (value: string): string => `${NUMBER}${value}__`;
const NUMBER_TOKEN = /"__JSON_NUMBER__(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)__"/g;
function rawJson(value: unknown): string {
  return JSON.stringify(value).replace(NUMBER_TOKEN, '$1');
}

const baseContext: StatementReportContext = {
  profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
  metadata: {
    erpVersion: '16.33.0', frappeVersion: '16.31.0', currency: 'IDR', defaultFinanceBook: null, hasFinanceBooks: false,
    calendar: [
      { name: 'FY 2023', start: '2023-01-01', end: '2023-12-31' },
      { name: 'FY 2024', start: '2024-01-01', end: '2024-12-31' },
      { name: 'FY 2025', start: '2025-01-01', end: '2025-12-31' },
    ],
    currencyPrecision: 2, floatPrecision: 3, bsOpeningPrecision: 2, roundingMethod: "Banker's Rounding",
    fractionUnits: 100, ignoreOpeningCheck: false, ignoreAccountClosingBalance: false,
  },
  publicationContext: {
    requestLanguage: 'en', currencyPrecisionBranch: 'db_default', floatPrecisionBranch: 'db_default',
    bsOpeningPrecisionBranch: 'db_default', numberFormatBranch: 'currency',
    raw: {
      company: { name: 'Synthetic Company', currency: 'IDR', defaultFinanceBook: null },
      accountsSettings: { ignoreOpeningCheck: 0, ignoreAccountClosingBalance: 0 },
      systemSettings: { language: 'en', currencyPrecision: 2, floatPrecision: 3, roundingMethod: "Banker's Rounding", useNumberFormatFromCurrency: 1, numberFormat: null },
      systemDefaults: { currencyPrecision: 2, floatPrecision: 3, roundingMethod: "Banker's Rounding", numberFormat: null },
      currency: { fractionUnits: 100, numberFormat: '#,###.##' },
      language: { name: 'en', enabled: 1, numberFormat: '#,###.##' },
    },
  },
};

function period(year: number, kind: StatementReportPeriod['kind'] = 'year'): StatementReportPeriod {
  return {
    fromDate: `${year}-01-01`, toDate: `${year}-12-31`,
    fromFiscalYear: `FY ${year}`, toFiscalYear: `FY ${year}`,
    kind, columnLabel: `Dec ${year}`,
  };
}
function selection(overrides: Partial<StatementReportSelection> = {}): StatementReportSelection {
  return {
    reportName: 'Profit and Loss Statement', company: 'Synthetic Company', side: 'current',
    periods: { current: period(2024), prior: period(2023) },
    ...overrides,
  };
}

const accountColumn = { fieldname: 'account', label: '<img src=x onerror=alert(1)>', fieldtype: 'Link', options: 'Account', width: numberToken('300.0') };
const basePlColumns = (fieldname = 'dec_2024', label = 'Dec 2024') => [
  accountColumn,
  { fieldname: 'acc_name', label: 'Account Name', fieldtype: 'Data', hidden: numberToken('1') },
  { fieldname: 'acc_number', label: 'Account Number', fieldtype: 'Data' },
  { fieldname: 'currency', label: 'Currency', fieldtype: 'Link', options: 'Currency' },
  { fieldname, label, fieldtype: 'Currency', options: 'currency', width: numberToken('150') },
  { fieldname: 'total', label: 'Total', fieldtype: 'Currency', options: 'currency' },
];

function accountRow(
  account: string,
  periodField: string,
  periodValue: string,
  totalValue = periodValue,
  overrides: Record<string, unknown> = {},
) {
  return {
    account, parent_account: 'Root - Synthetic Company', indent: numberToken('1.0'),
    acc_name: `Original ${account}`, acc_number: '1000', account_name: `<strong>${account}</strong>`,
    currency: 'IDR', is_group: numberToken('0'), has_value: true,
    [periodField]: numberToken(periodValue), total: numberToken(totalValue), ...overrides,
  };
}
function plPayload(options: {
  fieldname?: string;
  label?: string;
  rows?: unknown[];
  reportName?: string;
  filters?: unknown;
  summary?: unknown;
} = {}) {
  const message: Record<string, unknown> = {
    columns: basePlColumns(options.fieldname ?? 'dec_2024', options.label ?? 'Dec 2024'),
    result: options.rows ?? [accountRow('Accounts - North', options.fieldname ?? 'dec_2024', '19.0', '-0.0')],
    chart: { harmless: true }, status: 'success', execution_time: numberToken('0.12'),
    harmless_unknown_report_metadata: { accepted: true },
  };
  if (options.reportName !== undefined) message.report_name = options.reportName;
  if (options.filters !== undefined) message.filters = options.filters;
  if (options.summary !== undefined) message.report_summary = options.summary;
  return { message, harmlessEnvelopeMetadata: 'ignored' };
}
function summary(income: string, expense: string, net: string) {
  return [
    { value: numberToken(income), label: 'Translated first label', datatype: 'Currency', currency: 'IDR', indicator: 'Blue' },
    { value: numberToken(expense), label: 'Translated second label', datatype: 'Currency', currency: 'IDR' },
    { value: numberToken(net), label: 'Translated third label', datatype: 'Currency', currency: 'IDR' },
    { harmless: 'unused fourth item', native_extension: { nested: ['summary extra'] } },
  ];
}

function reportClient(body: unknown | ((request: Request) => unknown), status = 200) {
  const requests: Request[] = [];
  const deps: ErpClientDeps = {
    apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', baseUrl: 'https://erp.example.test', maxRetries: 0,
    fetchImpl: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      const responseBody = typeof body === 'function' ? (body as (request: Request) => unknown)(request) : body;
      return new Response(typeof responseBody === 'string' ? responseBody : rawJson(responseBody), { status, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch,
  };
  return { deps, requests };
}

async function fetchPl(
  options: Parameters<typeof plPayload>[0] = {},
  selected: StatementReportSelection = selection(),
  context: StatementReportContext = baseContext,
) {
  const payload = plPayload(options);
  const transport = reportClient(payload);
  const fetched = await fetchStatementReport(transport.deps, selected, context);
  return { ...transport, fetched, rawText: rawJson(payload) };
}

describe('erpnext/statementReports', () => {
  it('issues only the fixed GET with canonical standard filters and the prepared-report method argument', async () => {
    const selected = selection({ project: { projectId: 'pmo-project-1', erpProjectName: 'Mapped Project' } });
    const { requests, fetched } = await fetchPl({ summary: summary('19.0', '0.0', '19.0') }, selected);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(url.pathname).toBe('/api/method/frappe.desk.query_report.run');
    expect([...url.searchParams.keys()]).toEqual(['report_name', 'filters', 'ignore_prepared_report']);
    expect(url.searchParams.get('report_name')).toBe('Profit and Loss Statement');
    expect(url.searchParams.get('ignore_prepared_report')).toBe('1');
    const filters = JSON.parse(url.searchParams.get('filters')!);
    expect(filters).toEqual({
      company: 'Synthetic Company', finance_book: '', include_default_book_entries: 1, presentation_currency: 'IDR',
      cost_center: [], project: ['Mapped Project'], filter_based_on: 'Date Range', from_fiscal_year: 'FY 2024', to_fiscal_year: 'FY 2024',
      period_start_date: '2024-01-01', period_end_date: '2024-12-31', periodicity: 'Yearly', accumulated_values: 0,
      selected_view: 'Report', report_template: '', show_zero_values: 0,
    });
    expect(url.searchParams.get('company')).toBeNull();
    expect(url.searchParams.get('project')).toBeNull();
    expect(filters).not.toHaveProperty('ignore_prepared_report');
    expect(request.credentials).toBe('omit');
    expect(request.redirect).toBe('manual');
    expect(request.headers.get('Accept-Language')).toBe('en');
    expect(request.headers.get('Authorization')).toBe('token synthetic-key:synthetic-secret');
    expect(fetched.report.provenance.filters).toEqual(filters);
  });

  it('uses the exact Trial Balance and Balance Sheet filter sets without project scope', async () => {
    const tbColumns = [
      { fieldname: 'account', label: 'Account', fieldtype: 'Link' },
      ...['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'].map((fieldname) => ({ fieldname, label: fieldname, fieldtype: 'Currency' })),
    ];
    const tbRow: Record<string, unknown> = { account: 'Account A', parent_account: null, acc_name: 'A', acc_number: null, indent: numberToken('0.0') };
    for (const field of ['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit']) tbRow[field] = numberToken('0.0');
    const tbTransport = reportClient({ message: { columns: tbColumns, result: [tbRow, { account: "'Total'", debit: numberToken('0.0') }] } });
    const tbSelection = selection({ reportName: 'Trial Balance', side: 'current' });
    await fetchStatementReport(tbTransport.deps, tbSelection, baseContext);
    const tbFilters = JSON.parse(new URL(tbTransport.requests[0].url).searchParams.get('filters')!);
    expect(tbFilters).toEqual({
      company: 'Synthetic Company', finance_book: '', include_default_book_entries: 1, presentation_currency: 'IDR',
      cost_center: [], project: [], fiscal_year: 'FY 2024', from_date: '2024-01-01', to_date: '2024-12-31',
      with_period_closing_entry_for_opening: 1, with_period_closing_entry_for_current_period: 1,
      show_group_accounts: 1, show_net_values: 1, show_zero_values: 0, show_unclosed_fy_pl_balances: 0,
    });

    const bsTransport = reportClient({ message: { columns: basePlColumns().filter((column) => column.fieldname !== 'total'), result: [] } });
    await fetchStatementReport(bsTransport.deps, selection({ reportName: 'Balance Sheet' }), baseContext);
    const bsFilters = JSON.parse(new URL(bsTransport.requests[0].url).searchParams.get('filters')!);
    expect(bsFilters).toMatchObject({
      filter_based_on: 'Date Range', periodicity: 'Yearly', accumulated_values: 1, selected_view: 'Report',
      report_template: '', show_zero_values: 0, project: [],
    });
  });

  it('rejects unsupported report/project/range/company context before issuing HTTP', async () => {
    const invalidSelections = [
      selection({ reportName: 'Other Report' as StatementReportSelection['reportName'] }),
      selection({ reportName: 'Balance Sheet', project: { projectId: 'p', erpProjectName: 'Mapped Project' } }),
      selection({ company: 'Different Company' }),
      selection({ periods: { current: period(2024), prior: period(2024) } }),
      { ...selection(), periods: { current: { ...period(2024), toFiscalYear: 'missing' }, prior: period(2023) } },
    ];
    for (const invalid of invalidSelections) {
      const transport = reportClient({ message: { columns: [], result: [] } });
      await expect(fetchStatementReport(transport.deps, invalid, baseContext)).rejects.toThrow();
      expect(transport.deps.fetchImpl).not.toHaveBeenCalled();
    }
    const wrongNativeField = reportClient(plPayload({ fieldname: 'nov_2024', label: 'Translated native label' }));
    await expect(fetchStatementReport(wrongNativeField.deps, selection(), baseContext)).rejects.toThrow();
    expect(wrongNativeField.deps.fetchImpl).toHaveBeenCalledTimes(1);

    const wrongRange = reportClient((request: Request) => {
      const filters = JSON.parse(new URL(request.url).searchParams.get('filters')!);
      filters.period_end_date = '2024-11-30';
      return plPayload({ filters });
    });
    await expect(fetchStatementReport(wrongRange.deps, selection(), baseContext)).rejects.toThrow();
  });

  it('AC-001 preserves lexical values, native order, sparse footers and literal labels as React text data', async () => {
    const rows = [
      accountRow('Account A', 'dec_2024', '900719925474099312345.678900', '-0.0', {
        indent: numberToken('19.0'), is_group: numberToken('1'), native_extension: { nested: ['retained in raw text'] },
        native_array: ['unused array', { nested: true }], native_note: 'scalar retained',
      }),
      {},
      { account: "'Total Income'", account_name: "'<strong>Total Income</strong>'", currency: 'IDR', total: numberToken('19.0') },
    ];
    const payload = plPayload({ rows, summary: summary('900719925474099312345.678900', '0.0', '-0.0') });
    (payload.message.columns as Array<Record<string, unknown>>)[0].native_extension = { nested: ['column extra'] };
    const transport = reportClient(payload);
    const fetched = await fetchStatementReport(transport.deps, selection(), baseContext);
    const rawText = rawJson(payload);
    expect(fetched.rawText).toBe(rawText);
    expect(fetched.report.columns.map(({ fieldname }) => fieldname)).toEqual(['account', 'acc_name', 'acc_number', 'currency', 'dec_2024', 'total']);
    expect(fetched.report.columns[0]).toMatchObject({ label: '<img src=x onerror=alert(1)>', type: 'text', width: 300 });
    expect(fetched.report.columns[0]).not.toHaveProperty('options');
    expect(fetched.report.rows[0]).toMatchObject({
      account: 'Account A', indent: 19, is_group: true,
      dec_2024: '900719925474099312345.678900', total: '-0.0',
      account_name: '<strong>Account A</strong>', native_note: 'scalar retained',
    });
    expect(fetched.report.rows[0]).not.toHaveProperty('native_extension');
    expect(fetched.report.rows[0]).not.toHaveProperty('native_array');
    expect(fetched.report.rows[1]).toEqual({});
    expect(fetched.report.rows[2]).toMatchObject({ account: "'Total Income'", total: '19.0' });
    expect(fetched.report.provenance.rawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetched.report.provenance.acquiredAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(fetched.report.profile).toEqual(baseContext.profile);
    expect(fetched.report.language).toBe('en');
    expect(fetched.report.project).toBeNull();
  });

  it('accepts month, quarter and year native labels without requiring a translated expected label', async () => {
    const cases: Array<{
      kind: StatementReportPeriod['kind'];
      current: StatementReportPeriod;
      prior: StatementReportPeriod;
      fieldname: string;
      nativeLabel: string;
    }> = [
      {
        kind: 'month',
        current: { fromDate: '2024-03-01', toDate: '2024-03-31', fromFiscalYear: 'FY 2024', toFiscalYear: 'FY 2024', kind: 'month' },
        prior: { fromDate: '2023-03-01', toDate: '2023-03-31', fromFiscalYear: 'FY 2023', toFiscalYear: 'FY 2023', kind: 'month' },
        fieldname: 'mar_2024', nativeLabel: 'März 2024',
      },
      {
        kind: 'quarter',
        current: { fromDate: '2024-04-01', toDate: '2024-06-30', fromFiscalYear: 'FY 2024', toFiscalYear: 'FY 2024', kind: 'quarter', columnLabel: 'Different compatibility label' },
        prior: { fromDate: '2023-04-01', toDate: '2023-06-30', fromFiscalYear: 'FY 2023', toFiscalYear: 'FY 2023', kind: 'quarter' },
        fieldname: 'jun_2024', nativeLabel: 'T2 2024',
      },
      {
        kind: 'year',
        current: { fromDate: '2024-01-01', toDate: '2024-12-31', fromFiscalYear: 'FY 2024', toFiscalYear: 'FY 2024', kind: 'year' },
        prior: { fromDate: '2023-01-01', toDate: '2023-12-31', fromFiscalYear: 'FY 2023', toFiscalYear: 'FY 2023', kind: 'year' },
        fieldname: 'dec_2024', nativeLabel: '2024 (native locale)',
      },
    ];
    for (const item of cases) {
      const selected = selection({ periods: { current: item.current, prior: item.prior } });
      const transport = reportClient(plPayload({
        fieldname: item.fieldname,
        label: item.nativeLabel,
        rows: [accountRow('Account A', item.fieldname, '19.0')],
      }));
      const fetched = await fetchStatementReport(transport.deps, selected, baseContext);
      expect(fetched.report.columns.find((column) => column.fieldname === item.fieldname)?.label).toBe(item.nativeLabel);
      expect(JSON.parse(new URL(transport.requests[0].url).searchParams.get('filters')!).periodicity)
        .toBe(item.kind === 'month' ? 'Monthly' : item.kind === 'quarter' ? 'Quarterly' : 'Yearly');
    }
  });

  it('binds quarterly periods to the source-derived end-month key and selected periodicity', async () => {
    const quarter = (year: number): StatementReportPeriod => ({
      fromDate: `${year}-10-01`, toDate: `${year}-12-31`, fromFiscalYear: `FY ${year}`, toFiscalYear: `FY ${year}`,
      kind: 'quarter', columnLabel: `Q4 ${year}`,
    });
    const selected = selection({ periods: { current: quarter(2024), prior: quarter(2023) } });
    const transport = reportClient(plPayload({ fieldname: 'dec_2024', label: 'Q4 2024' }));
    await fetchStatementReport(transport.deps, selected, baseContext);
    const url = new URL(transport.requests[0].url);
    expect(JSON.parse(url.searchParams.get('filters')!)).toMatchObject({
      period_start_date: '2024-10-01', period_end_date: '2024-12-31', periodicity: 'Quarterly', accumulated_values: 0,
    });
  });

  it('parses a caller-supplied lossless body deterministically and computes provenance from the original text', async () => {
    const body = {
      message: {
        columns: [
          { fieldname: 'account', label: 'Account', fieldtype: 'Link' },
          { fieldname: 'dec_2024', label: 'Dec 2024', fieldtype: 'Currency' },
          { fieldname: 'total', label: 'Total', fieldtype: 'Currency' },
        ],
        result: [{ account: 'Account A', acc_name: 'A', acc_number: null, parent_account: '', indent: '0.0', dec_2024: '19.0', total: '-0.0' }],
      },
    };
    const rawText = JSON.stringify(body);
    const parsed = await parseStatementReport({ body, rawText }, selection(), baseContext, '2026-10-18T00:00:00.000Z');
    expect(parsed.rows[0]).toMatchObject({ indent: 0, dec_2024: '19.0', total: '-0.0' });
    expect(parsed.provenance.acquiredAt).toBe('2026-10-18T00:00:00.000Z');
    expect(parsed.provenance.rawSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts a complete native empty company report and absent optional summary without fabricating rows', async () => {
    const { fetched } = await fetchPl({ rows: [] });
    expect(fetched.report.rows).toEqual([]);
    expect(fetched.report.summary).toBeNull();
  });

  it('binds optional returned report identity and filters to the exact request while allowing response extras', async () => {
    const transport = reportClient((request: Request) => {
      const url = new URL(request.url);
      return plPayload({
        reportName: 'Profit and Loss Statement',
        filters: JSON.parse(url.searchParams.get('filters')!),
        summary: summary('10.0', '2.0', '8.0'),
      });
    });
    const fetched = await fetchStatementReport(transport.deps, selection(), baseContext);
    expect(fetched.report.rows).toHaveLength(1);

    const mismatchTransport = reportClient(plPayload({ reportName: 'Balance Sheet' }));
    await expect(fetchStatementReport(mismatchTransport.deps, selection(), baseContext)).rejects.toThrow();
  });

  it('rejects missing consumed account amounts, malformed visible values, duplicate columns and unsafe monetary lexemes', async () => {
    const transport = reportClient({ message: { columns: basePlColumns(), result: [accountRow('Account A', 'dec_2024', '1.0')] } });
    const selected = selection();
    const context = baseContext;
    const missingCell = plPayload({ rows: [{ ...accountRow('Account A', 'dec_2024', '1.0'), dec_2024: undefined }] });
    const missingRaw = rawJson(missingCell);
    const rawTransport = reportClient(missingRaw);
    await expect(fetchStatementReport(rawTransport.deps, selected, context)).rejects.toThrow();
    expect(transport.deps.fetchImpl).not.toHaveBeenCalled();

    const duplicateColumns = plPayload();
    (duplicateColumns.message.columns as Array<Record<string, unknown>>).push({ fieldname: 'dec_2024', label: 'Duplicate', fieldtype: 'Currency' });
    const duplicateTransport = reportClient(duplicateColumns);
    await expect(fetchStatementReport(duplicateTransport.deps, selected, context)).rejects.toThrow();

    const invalidAmount = plPayload({ rows: [accountRow('Account A', 'dec_2024', '1.0', '1.0', { dec_2024: true })] });
    const invalidTransport = reportClient(invalidAmount);
    await expect(fetchStatementReport(invalidTransport.deps, selected, context)).rejects.toThrow();

    const invalidLexeme = plPayload({ rows: [accountRow('Account A', 'dec_2024', '1.0', '1.0', { dec_2024: 'not-a-number' })] });
    const invalidLexemeTransport = reportClient(invalidLexeme);
    await expect(fetchStatementReport(invalidLexemeTransport.deps, selected, context)).rejects.toThrow();

    const invalidConsumedCells = [
      { account: { name: 'not a visible scalar' } },
      { acc_name: { name: 'not a scalar label' } },
      { indent: numberToken('101') },
      { is_group: 'yes' },
    ];
    for (const override of invalidConsumedCells) {
      const invalid = reportClient(plPayload({ rows: [accountRow('Account A', 'dec_2024', '1.0', '1.0', override)] }));
      await expect(fetchStatementReport(invalid.deps, selected, context)).rejects.toThrow();
    }

    const badEnvelope = reportClient({ message: [] });
    await expect(fetchStatementReport(badEnvelope.deps, selected, context)).rejects.toThrow();
  });

  it('AC-001 copies required native project summary tokens in position order without arithmetic or ERP detail', async () => {
    const selected = selection({ project: { projectId: 'local-project-key', erpProjectName: 'Mapped Project' } });
    const { fetched } = await fetchPl({ summary: summary('123456789012345.600', '0.0', '-0.0') }, selected);
    const totals = projectStatementTotals(fetched.report);
    expect(totals).toEqual({ income: '123456789012345.600', expense: '0.0', net: '-0.0', currency: 'IDR' });
    expect(fetched.report.summary?.[3]).toEqual({ harmless: 'unused fourth item' });
    expect(totals).not.toHaveProperty('rows');
    expect(totals).not.toHaveProperty('rawText');
    expect(totals).not.toHaveProperty('filters');
    expect(totals).not.toHaveProperty('project');
    expect(totals).not.toHaveProperty('company');

    const projectSelection = selection({ project: { projectId: 'local-project-key', erpProjectName: 'Mapped Project' } });
    const noSummary = reportClient(plPayload());
    await expect(fetchStatementReport(noSummary.deps, projectSelection, baseContext)).rejects.toThrow();
    expect(() => projectStatementTotals({ ...fetched.report, summary: null })).toThrow();

    for (const invalidSummary of [
      [{ value: numberToken('1.0'), datatype: 'Currency', currency: 'IDR' }],
      [
        { value: numberToken('1.0'), datatype: 'Currency', currency: 'IDR' },
        { value: numberToken('2.0'), datatype: 'Currency', currency: 'USD' },
        { value: numberToken('3.0'), datatype: 'Currency', currency: 'IDR' },
      ],
      [
        { value: numberToken('1.0'), datatype: 'Currency', currency: 'IDR' },
        { value: numberToken('2.0'), datatype: 'Data', currency: 'IDR' },
        { value: numberToken('3.0'), datatype: 'Currency', currency: 'IDR' },
      ],
    ]) {
      const invalid = reportClient(plPayload({ summary: invalidSummary }));
      await expect(fetchStatementReport(invalid.deps, projectSelection, baseContext)).rejects.toThrow();
    }

    const withSummaryExtras = summary('1.0', '2.0', '3.0') as Array<Record<string, unknown>>;
    withSummaryExtras[0].native_extension = { nested: ['harmless'] };
    const extraSummaryTransport = reportClient(plPayload({ summary: withSummaryExtras }));
    const extraSummaryReport = await fetchStatementReport(extraSummaryTransport.deps, projectSelection, baseContext);
    expect(extraSummaryReport.rawText).toContain('native_extension');
    expect(extraSummaryReport.report.summary?.[0]).not.toHaveProperty('native_extension');
  });

  it('joins current-order accounts then prior-only accounts and records native omission without zero cells', async () => {
    const currentRows = [
      accountRow('Account A', 'dec_2024', '10.0'),
      accountRow('Account C', 'dec_2024', '-0.0'),
      {},
      { account: "'Current Total'", total: numberToken('10.0') },
    ];
    const priorRows = [
      accountRow('Account A', 'dec_2023', '8.0'),
      {},
      accountRow('Account B', 'dec_2023', '2.0'),
      { account: "'Prior Total'", total: numberToken('10.0') },
    ];
    const currentTransport = reportClient(plPayload({ fieldname: 'dec_2024', label: 'Dec 2024', rows: currentRows }));
    const priorTransport = reportClient(plPayload({ fieldname: 'dec_2023', label: 'Dec 2023', rows: priorRows }));
    const [current, prior] = await Promise.all([
      fetchStatementReport(currentTransport.deps, selection({ side: 'current' }), baseContext),
      fetchStatementReport(priorTransport.deps, selection({ side: 'prior' }), baseContext),
    ]);
    const pair = joinStatementReportPair(current.report, prior.report);
    expect(pair.current).toBe(current.report);
    expect(pair.prior).toBe(prior.report);
    expect(pair.accounts.map((row) => row.account)).toEqual(['Account A', 'Account C', 'Account B']);
    expect(pair.accounts[0]).toMatchObject({
      current: { status: 'present', ordinal: 0, cells: { dec_2024: '10.0' } },
      prior: { status: 'present', ordinal: 0, cells: { dec_2023: '8.0' } },
    });
    expect(pair.accounts[1]).toMatchObject({
      current: { status: 'present', ordinal: 1, cells: { dec_2024: '-0.0' } },
      prior: { status: 'native_omitted', ordinal: null, cells: null },
    });
    expect(pair.accounts[2]).toMatchObject({
      current: { status: 'native_omitted', ordinal: null, cells: null },
      prior: { status: 'present', ordinal: 2, cells: { dec_2023: '2.0' } },
    });
    expect(pair.current.rows[3]).toEqual({ account: "'Current Total'", total: '10.0' });
    expect(pair.prior.rows[3]).toEqual({ account: "'Prior Total'", total: '10.0' });
    expect(pair.accounts.some((row) => row.account.includes('Total'))).toBe(false);
  });

  it('AC-001 retains duplicate identity rejection while accepting changed cross-side account structure', async () => {
    const duplicateRows = [accountRow('Account A', 'dec_2024', '1.0'), accountRow('Account A', 'dec_2024', '2.0')];
    const duplicateTransport = reportClient(plPayload({ rows: duplicateRows }));
    await expect(fetchStatementReport(duplicateTransport.deps, selection(), baseContext)).rejects.toThrow();

    const currentTransport = reportClient(plPayload({ fieldname: 'dec_2024', rows: [accountRow('Account A', 'dec_2024', '1.0')] }));
    const changedPriorTransport = reportClient(plPayload({
      fieldname: 'dec_2023', label: 'Déc. 2023',
      rows: [accountRow('Account A', 'dec_2023', '1.0', '1.0', {
        acc_name: 'Translated prior label', acc_number: '9000', parent_account: 'Different Parent', indent: numberToken('3'),
      })],
    }));
    const current = await fetchStatementReport(currentTransport.deps, selection({ side: 'current' }), baseContext);
    const changedPrior = await fetchStatementReport(changedPriorTransport.deps, selection({ side: 'prior' }), baseContext);
    const pair = joinStatementReportPair(current.report, changedPrior.report);
    expect(pair.accounts.map((row) => row.account)).toEqual(['Account A']);
    expect(pair.accounts[0].current).toMatchObject({ status: 'present', cells: { acc_name: 'Original Account A', acc_number: '1000', parent_account: 'Root - Synthetic Company', indent: 1 } });
    expect(pair.accounts[0].prior).toMatchObject({ status: 'present', cells: { acc_name: 'Translated prior label', acc_number: '9000', parent_account: 'Different Parent', indent: 3 } });
    expect(() => joinStatementReportPair({
      ...current.report,
      periodPair: { ...current.report.periodPair, current: { ...current.report.periodPair.current, columnLabel: 'another optional hint' } },
    }, changedPrior.report)).not.toThrow();

    expect(() => joinStatementReportPair({ ...current.report, company: 'Other Company' }, changedPrior.report)).toThrow();
    expect(() => joinStatementReportPair(current.report, { ...changedPrior.report, reportName: 'Balance Sheet' })).toThrow();
    expect(() => joinStatementReportPair(current.report, { ...changedPrior.report, project: { projectId: 'other', erpProjectName: 'Other Project' } })).toThrow();
    expect(() => joinStatementReportPair({ ...current.report, language: 'fr' }, changedPrior.report)).toThrow();
    expect(() => joinStatementReportPair(current.report, { ...changedPrior.report, profile: { ...changedPrior.report.profile, erpVersion: 'other' } })).toThrow();
    expect(() => joinStatementReportPair(current.report, { ...changedPrior.report, side: 'current' })).toThrow();
    expect(() => joinStatementReportPair(current.report, {
      ...changedPrior.report,
      periodPair: { ...changedPrior.report.periodPair, current: period(2025) },
    })).toThrow();
  });

  it('AC-001 accepts the sparse native Trial Balance footer and irrelevant structured extras verbatim in raw text', async () => {
    const tbColumns = [
      { fieldname: 'account', label: 'Account', fieldtype: 'Link', ignored_column_metadata: { nested: [true] } },
      ...['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit']
        .map((fieldname) => ({ fieldname, label: fieldname, fieldtype: 'Currency' })),
    ];
    const footer: Record<string, unknown> = {
      account: 'Total', parent_account: null, indent: numberToken('0'),
      opening_debit: numberToken('1.00'), opening_credit: numberToken('0.00'),
      debit: numberToken('2.00'), credit: numberToken('0.00'),
      closing_debit: numberToken('3.00'), closing_credit: numberToken('0.00'),
      native_extension: { ignored: ['object', 'array'] },
    };
    const payload = {
      message: {
        columns: tbColumns,
        result: [
          {
            account: 'Cash - Sample', acc_name: 'Cash', acc_number: '1000', parent_account: 'Assets', indent: numberToken('1'),
            opening_debit: numberToken('0'), opening_credit: numberToken('0'), debit: numberToken('1'), credit: numberToken('0'),
            closing_debit: numberToken('1'), closing_credit: numberToken('0'),
          },
          {},
          footer,
        ],
        report_summary: [{ label: 'Unused', nested: { values: [1, 2] } }],
        unused_root_metadata: { nested: ['accepted'] },
      },
    };
    const transport = reportClient(payload);
    const fetched = await fetchStatementReport(transport.deps, selection({ reportName: 'Trial Balance' }), baseContext);
    expect(fetched.report.rows).toHaveLength(3);
    expect(fetched.report.rows[0].account).toBe('Cash - Sample');
    expect(fetched.report.rows[1]).toEqual({});
    expect(fetched.report.rows[2]).toMatchObject({ account: 'Total', parent_account: null, indent: 0, debit: '2.00', closing_debit: '3.00' });
    expect(fetched.report.rows[2]).not.toHaveProperty('native_extension');
    expect(fetched.rawText).toBe(rawJson(payload));
    expect(fetched.report.summary).toEqual([{ label: 'Unused' }]);
  });

  it('does not expose raw upstream bodies or messages when the GET fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const privateText = 'private upstream response body sentinel';
    const transport = reportClient({ exc_type: 'SyntheticFailure', message: privateText }, 503);
    try {
      await expect(fetchStatementReport(transport.deps, selection(), baseContext)).rejects.toMatchObject({ message: 'Statement report request failed' });
      expect(log).not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join(' ')).not.toContain(privateText);
    } finally {
      log.mockRestore();
    }
  });
});
