import { describe, expect, expectTypeOf, it } from 'vitest';
import type { StatementReportPair } from './adapterSeam/erpnext/statementReports';
import {
  parseFinancialStatementCatalogue,
  parseFinancialStatementRead,
  parseFinancialStatementRow,
  type FinancialStatementNativePayload,
} from './financialStatements';

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PROJECT_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ROUNDING_MODES = [
  "Banker's Rounding",
  "Banker's Rounding (legacy)",
  'Commercial Rounding',
  'erpnext_report_output',
] as const;
type NativePeriod = {
  fromDate: string; toDate: string; fromFiscalYear: string; toFiscalYear: string;
  kind: 'month' | 'quarter' | 'year'; columnLabel?: string;
};
type NativePeriodPair = { current: NativePeriod; prior: NativePeriod };
const CURRENT: NativePeriod = {
  fromDate: '2024-02-01', toDate: '2024-02-29',
  fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: 'month', columnLabel: 'Feb 2024',
};
const PRIOR: NativePeriod = {
  fromDate: '2024-01-01', toDate: '2024-01-31',
  fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: 'month', columnLabel: 'Jan 2024',
};
const PERIOD_PAIR = { current: CURRENT, prior: PRIOR };
const AS_OF = '2024-03-01T12:34:56.000Z';
const CAPTURE_STARTED = '2024-03-01T12:30:00.000Z';
const REPORT_NAMES = {
  trial_balance: 'Trial Balance',
  profit_and_loss: 'Profit and Loss Statement',
  balance_sheet: 'Balance Sheet',
} as const;

function nativeReport(
  side: 'current' | 'prior',
  statement: keyof typeof REPORT_NAMES = 'profit_and_loss',
  projectId: string | null = null,
  overrides: Record<string, unknown> = {},
  periodPair: NativePeriodPair = PERIOD_PAIR,
) {
  const period = side === 'current' ? periodPair.current : periodPair.prior;
  const field = period.toDate;
  const moneyFields = statement === 'trial_balance'
    ? ['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit']
    : [field, ...(statement === 'profit_and_loss' ? ['total'] : [])];
  const columns = [
    { fieldname: 'account', label: 'Account', type: 'text' },
    ...moneyFields.map((fieldname) => ({ fieldname, label: fieldname, type: 'currency' })),
  ];
  const row: Record<string, unknown> = {
    account: 'Revenue - Synthetic Co', acc_name: 'Revenue', acc_number: null,
    parent_account: null, indent: 0,
  };
  for (const key of moneyFields) row[key] = '-0.000e+0';
  return {
    reportName: REPORT_NAMES[statement], company: 'Synthetic Company', side,
    period, periodPair,
    project: projectId === null ? null : { projectId, erpProjectName: 'Synthetic Project' },
    language: 'en', profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
    columns, rows: [row], summary: null,
    provenance: {
      endpoint: '/api/method/frappe.desk.query_report.run', method: 'GET',
      ignorePreparedReport: 1, rawSha256: 'a'.repeat(64), acquiredAt: AS_OF,
      filters: { company: 'Synthetic Company', from_date: period.fromDate, to_date: period.toDate },
    },
    ...overrides,
  };
}

function nativePayload(
  statement: keyof typeof REPORT_NAMES = 'profit_and_loss',
  projectId: string | null = null,
  overrides: { current?: Record<string, unknown>; prior?: Record<string, unknown> } = {},
  periodPair: NativePeriodPair = PERIOD_PAIR,
) {
  return {
    current: nativeReport('current', statement, projectId, overrides.current, periodPair),
    prior: nativeReport('prior', statement, projectId, overrides.prior, periodPair),
  };
}

function row(overrides: Record<string, unknown> = {}) {
  const statement = (overrides.statement ?? 'profit_and_loss') as keyof typeof REPORT_NAMES;
  const scope = (overrides.scope_kind ?? 'company') as string;
  const projectId = (Object.hasOwn(overrides, 'project_id') ? overrides.project_id : scope === 'project' ? PROJECT_UUID : null) as string | null;
  const view = (overrides.view_kind ?? 'account_breakdown') as string;
  const totals = view === 'project_totals';
  const periodKind = String(overrides.period_kind ?? 'month');
  const nativeKind = (periodKind === 'fiscal_year' ? 'year' : periodKind) as NativePeriod['kind'];
  const periodPair: NativePeriodPair = {
    current: {
      fromDate: String(overrides.current_start ?? '2024-02-01'), toDate: String(overrides.current_end ?? '2024-02-29'),
      fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: nativeKind, columnLabel: 'Current',
    },
    prior: {
      fromDate: String(overrides.prior_start ?? '2024-01-01'), toDate: String(overrides.prior_end ?? '2024-01-31'),
      fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: nativeKind, columnLabel: 'Prior',
    },
  };
  const detailPayload = nativePayload(statement, projectId, {}, periodPair);
  const base = {
    id: UUID, org_id: OTHER_UUID, company: 'Synthetic Company', snapshot_id: PROJECT_UUID,
    source_generation: UUID, statement, scope_kind: scope, project_id: projectId, view_kind: view,
    period_kind: 'month', current_start: '2024-02-01', current_end: '2024-02-29',
    prior_start: '2024-01-01', prior_end: '2024-01-31', currency: 'IDR', as_of: AS_OF, published_at: AS_OF,
    capture_started_at: CAPTURE_STARTED, capture_completed_at: AS_OF,
    raw_reports: totals ? null : { current: '{"message":{"side":"current"}}', prior: '{"message":{"side":"prior"}}' },
    source_report: totals ? null : REPORT_NAMES[statement], report_version: totals ? null : '16.33.0',
    filters: totals ? null : {
      current: detailPayload.current.provenance.filters,
      prior: detailPayload.prior.provenance.filters,
    }, settings: totals ? null : { currencyPrecision: 3 },
    payload: totals
      ? { current: { income: '-0.000e+0', expense: '0', net: '-0' }, prior: { income: '0', expense: '0', net: '0' } }
      : detailPayload,
    has_activity: true, display_precision: 2, display_rounding_method: ROUNDING_MODES[0],
  };
  const result = { ...base, ...overrides };
  if (Object.hasOwn(overrides, 'as_of') && !Object.hasOwn(overrides, 'capture_completed_at')) {
    result.capture_completed_at = overrides.as_of as string;
  }
  if (Object.hasOwn(overrides, 'as_of') && !Object.hasOwn(overrides, 'published_at')) {
    result.published_at = overrides.as_of as string;
  }
  return result;
}

function expectInvalid(value: unknown) {
  expect(() => parseFinancialStatementRow(value)).toThrowError(
    new TypeError('Invalid financial statement row.'),
  );
}

const PERIOD = {
  kind: 'month', currentStart: '2024-02-01', currentEnd: '2024-02-29',
  priorStart: '2024-01-01', priorEnd: '2024-01-31',
};
const GENERATION = {
  snapshotId: UUID, sourceGeneration: OTHER_UUID, asOf: AS_OF,
  captureStartedAt: CAPTURE_STARTED, captureCompletedAt: AS_OF, currency: 'IDR',
  presentation: { precision: 3, roundingMethod: ROUNDING_MODES[1] }, delayed: true,
};
const CATALOGUE = {
  state: 'complete', companyLabel: 'Synthetic Company', generation: GENERATION,
  periods: [PERIOD],
  scopes: [
    { scopeKind: 'company', projectId: null, statements: ['trial_balance', 'profit_and_loss', 'balance_sheet'], viewKinds: ['account_breakdown'] },
    { scopeKind: 'project', projectId: PROJECT_UUID, statements: ['profit_and_loss'], viewKinds: ['account_breakdown', 'project_totals'] },
  ],
};
const EXPECTED_SELECTION = {
  periodKind: 'month', periodStart: PERIOD.currentStart, statement: 'profit_and_loss',
  scopeKind: 'company', projectId: null, viewKind: 'account_breakdown',
} as const;
const DETAIL_PAYLOAD = nativePayload();
const DETAIL_READ = {
  state: 'complete', companyLabel: 'Synthetic Company', generation: GENERATION,
  selection: EXPECTED_SELECTION,
  result: {
    viewKind: 'account_breakdown', period: PERIOD, hasActivity: false,
    payload: DETAIL_PAYLOAD,
    provenance: {
      sourceReport: 'Profit and Loss Statement', reportVersion: '16.33.0',
      filters: { current: DETAIL_PAYLOAD.current.provenance.filters, prior: DETAIL_PAYLOAD.prior.provenance.filters },
      settings: { currencyPrecision: 3 },
    },
  },
};

describe('strict financial statement read envelopes', () => {
  it('AC-006 keeps stored native reports structurally compatible with the ERP report pair', () => {
    expectTypeOf<FinancialStatementNativePayload>().toMatchTypeOf<Pick<StatementReportPair, 'current' | 'prior'>>();
  });

  it('AC-003/006 parses a complete native catalogue and preserves the generation window', () => {
    expect(parseFinancialStatementCatalogue(CATALOGUE)).toEqual(CATALOGUE);
  });

  it('AC-006 accepts native detail pairs and exact project totals without exposing raw bodies', () => {
    expect(parseFinancialStatementRead(DETAIL_READ, EXPECTED_SELECTION)).toEqual(DETAIL_READ);
    const projectSelection = {
      ...EXPECTED_SELECTION, scopeKind: 'project', projectId: PROJECT_UUID, viewKind: 'project_totals',
    } as const;
    const totals = {
      ...DETAIL_READ, selection: projectSelection,
      result: {
        viewKind: 'project_totals', period: PERIOD, hasActivity: true,
        payload: { current: { income: '7.25', expense: '3', net: '4.25' }, prior: { income: '0', expense: '0', net: '0' } },
      },
    };
    expect(parseFinancialStatementRead(totals, projectSelection)).toEqual(totals);
  });

  it('AC-006 accepts JSONB object key order while retaining exact detail filters', () => {
    const priorFirst = {
      ...DETAIL_READ,
      result: {
        ...DETAIL_READ.result,
        provenance: {
          ...DETAIL_READ.result.provenance,
          filters: {
            prior: DETAIL_READ.result.provenance.filters.prior,
            current: DETAIL_READ.result.provenance.filters.current,
          },
        },
      },
    };
    expect(parseFinancialStatementRead(priorFirst, EXPECTED_SELECTION)).toEqual(priorFirst);

    const readWithFilters = (filters: unknown) => ({
      ...priorFirst,
      result: {
        ...priorFirst.result,
        provenance: { ...priorFirst.result.provenance, filters },
      },
    });
    const expectedFilters = priorFirst.result.provenance.filters;
    for (const invalidFilters of [
      {
        prior: expectedFilters.prior,
        current: { company: 'Synthetic Company', from_date: '2024-02-01' },
      },
      {
        ...expectedFilters,
        current: { ...expectedFilters.current, unexpected: true },
      },
      {
        ...expectedFilters,
        current: { ...expectedFilters.current, from_date: 20240201 },
      },
    ]) {
      expect(() => parseFinancialStatementRead(readWithFilters(invalidFilters), EXPECTED_SELECTION)).toThrow(TypeError);
    }

    const currentFilters = { ...DETAIL_PAYLOAD.current.provenance.filters, selected_accounts: ['A', 'B'] };
    const priorFilters = { ...DETAIL_PAYLOAD.prior.provenance.filters, selected_accounts: ['A', 'B'] };
    const arrayPayload = {
      current: { ...DETAIL_PAYLOAD.current, provenance: { ...DETAIL_PAYLOAD.current.provenance, filters: currentFilters } },
      prior: { ...DETAIL_PAYLOAD.prior, provenance: { ...DETAIL_PAYLOAD.prior.provenance, filters: priorFilters } },
    };
    const arrayRead = {
      ...DETAIL_READ,
      result: {
        ...DETAIL_READ.result,
        payload: arrayPayload,
        provenance: { ...DETAIL_READ.result.provenance, filters: { prior: priorFilters, current: currentFilters } },
      },
    };
    expect(parseFinancialStatementRead(arrayRead, EXPECTED_SELECTION)).toEqual(arrayRead);
    const reorderedArrayRead = {
      ...arrayRead,
      result: {
        ...arrayRead.result,
        provenance: {
          ...arrayRead.result.provenance,
          filters: {
            ...arrayRead.result.provenance.filters,
            current: { ...currentFilters, selected_accounts: ['B', 'A'] },
          },
        },
      },
    };
    expect(() => parseFinancialStatementRead(reorderedArrayRead, EXPECTED_SELECTION)).toThrow(TypeError);

    const changedFilter = {
      ...priorFirst,
      result: {
        ...priorFirst.result,
        provenance: {
          ...priorFirst.result.provenance,
          filters: {
            ...priorFirst.result.provenance.filters,
            prior: { ...priorFirst.result.provenance.filters.prior, to_date: '2024-01-30' },
          },
        },
      },
    };
    expect(() => parseFinancialStatementRead(changedFilter, EXPECTED_SELECTION)).toThrow(TypeError);
  });

  it('AC-006 distinguishes stable unavailable and complete-empty envelopes', () => {
    const unavailable = { state: 'unavailable', companyLabel: null, generation: null, periods: [], scopes: [] };
    const unavailableRead = { state: 'unavailable', companyLabel: null, generation: null, selection: EXPECTED_SELECTION, result: null };
    expect(parseFinancialStatementCatalogue(unavailable)).toEqual(unavailable);
    expect(parseFinancialStatementRead(unavailableRead, EXPECTED_SELECTION)).toEqual(unavailableRead);
    expect(parseFinancialStatementRead(DETAIL_READ, EXPECTED_SELECTION).result?.hasActivity).toBe(false);
  });

  it('AC-006 rejects malformed catalogue windows, periods, scopes and unsupported unassigned scope', () => {
    const invalid = [
      { ...CATALOGUE, generation: { ...GENERATION, sourceGeneration: null } },
      { ...CATALOGUE, generation: { ...GENERATION, delayed: 'false' } },
      { ...CATALOGUE, generation: { ...GENERATION, captureCompletedAt: '2024-03-01T12:34:57.000Z' } },
      { ...CATALOGUE, generation: { ...GENERATION, asOf: '2024-03-01T12:34:55.000Z' } },
      { ...CATALOGUE, generation: { ...GENERATION, presentation: { ...GENERATION.presentation, precision: 10 } } },
      { ...CATALOGUE, generation: { ...GENERATION, presentation: { ...GENERATION.presentation, roundingMethod: 'Unknown' } } },
      { ...CATALOGUE, periods: [{ ...PERIOD, priorEnd: '2024-01-30' }] },
      { ...CATALOGUE, periods: [PERIOD, { ...PERIOD, currentEnd: '2024-02-28' }] },
      { ...CATALOGUE, scopes: [...CATALOGUE.scopes, CATALOGUE.scopes[0]] },
      { ...CATALOGUE, scopes: [{ ...CATALOGUE.scopes[0], extra: true }] },
      { ...CATALOGUE, scopes: [{ scopeKind: 'unassigned', projectId: null, statements: ['profit_and_loss'], viewKinds: ['account_breakdown'] }] },
      { ...CATALOGUE, state: 'unavailable' }, { ...CATALOGUE, periods: [] }, { ...CATALOGUE, leaked: true },
    ];
    for (const [index, value] of invalid.entries()) {
      expect(() => parseFinancialStatementCatalogue(value), `invalid catalogue fixture ${index}`).toThrow(TypeError);
    }
  });

  it('AC-004/006 rejects wrong selection, mixed capture windows, bad dates and totals poisoning', () => {
    const invalid = [
      { ...DETAIL_READ, selection: { ...EXPECTED_SELECTION, projectId: PROJECT_UUID } },
      { ...DETAIL_READ, generation: { ...GENERATION, snapshotId: 'not-a-uuid' } },
      { ...DETAIL_READ, generation: { ...GENERATION, captureStartedAt: '2024-03-01T12:34:57.000Z' } },
      { ...DETAIL_READ, result: { ...DETAIL_READ.result, period: { ...PERIOD, priorStart: '2023-12-01' } } },
      { ...DETAIL_READ, result: { ...DETAIL_READ.result, provenance: { ...DETAIL_READ.result.provenance, secret: true } } },
      { ...DETAIL_READ, result: { ...DETAIL_READ.result, payload: { current: {}, prior: {} } } },
    ];
    for (const value of invalid) expect(() => parseFinancialStatementRead(value, EXPECTED_SELECTION)).toThrow(TypeError);

    const selection = { ...EXPECTED_SELECTION, scopeKind: 'project', projectId: PROJECT_UUID, viewKind: 'project_totals' } as const;
    const poisoned = {
      state: 'complete', companyLabel: null, generation: GENERATION, selection,
      result: {
        viewKind: 'project_totals', period: PERIOD, hasActivity: true,
        payload: { current: { income: '7.25', expense: '3', net: '4.25', rows: [] }, prior: { income: '0', expense: '0', net: '0' } },
        provenance: null,
      },
    };
    expect(() => parseFinancialStatementRead(poisoned, selection)).toThrow(TypeError);
    expect(() => parseFinancialStatementRead({ ...DETAIL_READ, result: { ...DETAIL_READ.result, payload: { ...nativePayload(), rawText: 'private' } } }, EXPECTED_SELECTION)).toThrow(TypeError);
  });
});

describe('parseFinancialStatementRow native storage boundary', () => {
  it('returns a defensive copy of a complete generated native storage row', () => {
    const input = row();
    const parsed = parseFinancialStatementRow(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.payload).not.toBe(input.payload);
    expect(parsed.raw_reports).not.toBe(input.raw_reports);
    expect(parsed.filters).not.toBe(input.filters);
    expect(parsed.settings).not.toBe(input.settings);
  });

  it('accepts each native report kind and mapped-project detail without calculator output', () => {
    for (const statement of ['trial_balance', 'profit_and_loss', 'balance_sheet'] as const) {
      const parsed = parseFinancialStatementRow(row({ statement }));
      expect(parsed.statement).toBe(statement);
      expect(parsed.payload).toEqual(row({ statement }).payload);
    }
    const project = parseFinancialStatementRow(row({ scope_kind: 'project', project_id: PROJECT_UUID }));
    expect((project.payload as FinancialStatementNativePayload).current.project).toEqual({ projectId: PROJECT_UUID, erpProjectName: 'Synthetic Project' });
    expectInvalid(row({ scope_kind: 'unassigned', project_id: null }));
  });

  it('accepts equal native project and profile objects regardless of JSONB key order', () => {
    const reorderedPairs = [
      { prior: { project: { erpProjectName: 'Synthetic Project', projectId: PROJECT_UUID } } },
      { prior: { profile: { frappeVersion: '16.31.0', erpVersion: '16.33.0' } } },
    ];
    for (const pairOverrides of reorderedPairs) {
      const payload = nativePayload('profit_and_loss', PROJECT_UUID, pairOverrides);
      expect(parseFinancialStatementRow(row({
        scope_kind: 'project', project_id: PROJECT_UUID, payload,
      })).payload).toEqual(payload);
    }
  });

  it('accepts prior-first JSONB filters on a stored native row and rejects changed filter values', () => {
    const input = row();
    const filters = input.filters as { current: Record<string, unknown>; prior: Record<string, unknown> };
    const priorFirst = {
      ...input,
      filters: { prior: filters.prior, current: filters.current },
    };
    expect(parseFinancialStatementRow(priorFirst)).toEqual(priorFirst);

    const changedFilter = {
      ...priorFirst,
      filters: {
        ...priorFirst.filters,
        prior: { ...priorFirst.filters.prior, to_date: '2024-01-30' },
      },
    };
    expectInvalid(changedFilter);
  });

  it('does not mutate frozen native payloads or nested report data', () => {
    const native = nativePayload();
    const frozenRows = Object.freeze(native.current.rows.map((item) => Object.freeze(item)));
    const frozenCurrent = Object.freeze({ ...native.current, rows: frozenRows });
    const frozenPayload = Object.freeze({ current: frozenCurrent, prior: Object.freeze(native.prior) });
    const input = Object.freeze(row({ payload: frozenPayload }));
    const parsed = parseFinancialStatementRow(input);
    expect(parsed.payload).not.toBe(frozenPayload);
    expect((parsed.payload as FinancialStatementNativePayload).current.rows).not.toBe(frozenRows);
    expect(input.payload).toBe(frozenPayload);
  });

  it('preserves native lexical amounts, exponent notation, signed zero, sparse rows and native ordering', () => {
    const parsed = parseFinancialStatementRow(row({ payload: nativePayload('profit_and_loss', null, {
      current: {
        rows: [
          { account: 'B', acc_name: 'B', indent: 0, '2024-02-29': '-0.000e+0' },
          { account: 'A', acc_name: 'A', indent: 0, total: '1E+09' },
        ],
        summary: [{ label: 'Net', datatype: 'Currency', value: '-0.00e-0' }],
      },
      prior: {},
    }) }));
    const payload = parsed.payload as FinancialStatementNativePayload;
    expect(payload.current.rows[0]?.['2024-02-29']).toBe('-0.000e+0');
    expect(payload.current.rows[1]?.total).toBe('1E+09');
    expect(payload.current.summary?.[0]?.value).toBe('-0.00e-0');
    expect(payload.current.rows.map((item) => item.account)).toEqual(['B', 'A']);
    expect(payload.current.rows[0]).not.toHaveProperty('key');
    expect(payload.current).not.toHaveProperty('accounts');
  });

  it('requires exactly the generated row columns, including capture bounds and raw-pair storage', () => {
    for (const key of Object.keys(row())) {
      const candidate = { ...row() };
      delete candidate[key as keyof typeof candidate];
      expectInvalid(candidate);
    }
    expectInvalid({ ...row(), injected: 'synthetic-secret-marker' });
  });

  it('rejects null for every required generated identity/value and permits only declared nullable columns', () => {
    const required = [
      'id', 'org_id', 'company', 'snapshot_id', 'source_generation', 'statement', 'scope_kind',
      'view_kind', 'period_kind', 'current_start', 'current_end', 'prior_start', 'prior_end', 'currency',
      'as_of', 'capture_started_at', 'capture_completed_at', 'payload', 'raw_reports', 'has_activity',
      'display_precision', 'display_rounding_method',
    ];
    for (const field of required) expectInvalid(row({ [field]: null }));
    expectInvalid(row({ scope_kind: 'project', project_id: null }));
    expectInvalid(row({ raw_reports: null }));
    const totals = parseFinancialStatementRow(row({ view_kind: 'project_totals', scope_kind: 'project' }));
    expect(totals.source_report).toBeNull();
    expect(totals.report_version).toBeNull();
    expect(totals.filters).toBeNull();
    expect(totals.settings).toBeNull();
  });

  it('validates acquisition-window bounds separately from publication time', () => {
    expectInvalid(row({ capture_started_at: '2024-03-01T12:34:57.000Z' }));
    expectInvalid(row({ capture_completed_at: '2024-03-01T12:34:55.000Z' }));
    expect(parseFinancialStatementRow(row({ as_of: '2024-03-01T12:34:57.000Z', capture_completed_at: AS_OF })))
      .toMatchObject({ as_of: '2024-03-01T12:34:57.000Z', published_at: '2024-03-01T12:34:57.000Z' });
    expect(parseFinancialStatementRow(row({ published_at: null })).published_at).toBeNull();
    expectInvalid(row({ published_at: '2024-03-01T12:34:55.000Z' }));
    expectInvalid(row({ raw_reports: { current: 'current only' } }));
    expectInvalid(row({ raw_reports: { current: 1, prior: 'prior' } }));
    expectInvalid(row({ capture_started_at: null, capture_completed_at: null }));
    expectInvalid(row({ payload: nativePayload('profit_and_loss', null, {
      current: { provenance: { endpoint: '/api/method/frappe.desk.query_report.run', method: 'GET', ignorePreparedReport: 1,
        rawSha256: 'a'.repeat(64), acquiredAt: '2024-03-01T12:29:59.000Z',
        filters: { company: 'Synthetic Company', from_date: '2024-02-01', to_date: '2024-02-29' } } },
    }) }));
  });

  it('accepts valid fractional timestamps with explicit offsets and rejects impossible times or offsets', () => {
    for (const as_of of [
      '2024-03-01T23:59:59.123456Z', '2024-03-02T03:59:59+12:00', '2024-03-01T16:00:00-04:30',
    ]) expect(parseFinancialStatementRow(row({ as_of })).as_of).toBe(as_of);
    for (const as_of of [
      '2023-02-29T12:00:00Z', '2024-02-30T12:00:00Z', '2024-02-29T25:00:00Z',
      '2024-02-29T12:00:00', '2024-02-29 12:00:00Z', '2024-02-29T12:00:00+14:01',
      '2024-02-29T12:00:00+15:00', '2024-02-29T12:00:00+02:60',
    ]) expectInvalid(row({ as_of }));
  });

  it('rejects non-record roots, arrays, class instances, unknown fields and malformed scalar values', () => {
    class SnapshotRow { id = UUID; }
    expectInvalid(null); expectInvalid([]); expectInvalid(new SnapshotRow());
    for (const overrides of [
      { id: 9 }, { org_id: false }, { company: ' ' }, { snapshot_id: {} }, { source_generation: 3 },
      { statement: 1 }, { scope_kind: false }, { project_id: {} }, { view_kind: [] }, { period_kind: 3 },
      { current_start: 20240201 }, { current_end: null }, { prior_start: false }, { prior_end: {} },
      { currency: 'USD' }, { as_of: 123 }, { published_at: 123 }, { capture_started_at: {} }, { capture_completed_at: 123 }, { source_report: {} },
      { report_version: 9 }, { filters: undefined }, { settings: Infinity }, { payload: [] },
      { raw_reports: [] }, { has_activity: 'true' }, { display_precision: '2' },
      { display_rounding_method: {} },
    ]) expectInvalid(row(overrides));
  });

  it('requires UUID syntax, valid Gregorian dates, adjacent ranges and supported period sizes', () => {
    for (const field of ['id', 'org_id', 'snapshot_id', 'source_generation'] as const) expectInvalid(row({ [field]: 'not-a-uuid' }));
    expectInvalid(row({ scope_kind: 'project', project_id: 'not-a-uuid' }));
    for (const current_start of ['2023-02-29', '2024-02-30', '2024-13-01', '2024-2-01']) expectInvalid(row({ current_start }));
    for (const overrides of [
      { current_start: '2024-03-01', current_end: '2024-02-29' },
      { current_start: '2024-02-02' }, { current_end: '2024-02-28' },
      { prior_start: '2024-01-02' }, { prior_end: '2024-01-30' },
      { prior_start: '2023-12-01', prior_end: '2023-12-31' }, { period_kind: 'year' },
    ]) expectInvalid(row(overrides));
    expect(parseFinancialStatementRow(row({
      current_start: '2024-01-01', current_end: '2024-03-31', prior_start: '2023-10-01', prior_end: '2023-12-31', period_kind: 'quarter',
    })).period_kind).toBe('quarter');
    expect(parseFinancialStatementRow(row({
      current_start: '2024-02-01', current_end: '2025-01-31', prior_start: '2023-02-01', prior_end: '2024-01-31', period_kind: 'fiscal_year',
    })).period_kind).toBe('fiscal_year');
  });

  it('validates report pair identity, sides, company, profile and selection periods', () => {
    expectInvalid(row({ payload: nativePayload('profit_and_loss', null, { current: { side: 'prior' } }) }));
    expectInvalid(row({ payload: nativePayload('profit_and_loss', null, { prior: { company: 'Other Company' } }) }));
    expectInvalid(row({ payload: nativePayload('profit_and_loss', null, { current: { reportName: 'Balance Sheet' } }) }));
    expectInvalid(row({ payload: nativePayload('profit_and_loss', null, { prior: { periodPair: { current: PRIOR, prior: CURRENT } } }) }));
    expectInvalid(row({ payload: nativePayload('profit_and_loss', null, { current: { provenance: { rawSha256: 'bad' } } }) }));
    expectInvalid(row({ payload: nativePayload('profit_and_loss', null, { current: { profile: { erpVersion: '16.33.0' } } }) }));
  });

  it('validates all six native Trial Balance Currency cells as lexical strings on both sides', () => {
    const base = parseFinancialStatementRow(row({ statement: 'trial_balance' }));
    const payload = base.payload as FinancialStatementNativePayload;
    expect(payload.current.columns.filter((column) => column.type === 'currency').map((column) => column.fieldname)).toEqual([
      'opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit',
    ]);
    for (const side of ['current', 'prior'] as const) {
      for (const field of ['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit']) {
        const report = payload[side];
        const mutated = {
          ...payload,
          [side]: { ...report, rows: report.rows.map((item) => ({ ...item, [field]: 1 })) },
        };
        expectInvalid(row({ statement: 'trial_balance', payload: mutated }));
      }
    }
  });

  it('retains totals as exact string-only summary positions with no detail provenance or raw bodies', () => {
    const huge = '-999999999999999999999999999999999999999.123456789e+8';
    const parsed = parseFinancialStatementRow(row({
      view_kind: 'project_totals', scope_kind: 'project', project_id: PROJECT_UUID,
      payload: { current: { income: huge, expense: '0.000000001', net: '-0' }, prior: { income: '0', expense: huge, net: '1.25' } },
    }));
    expect(parsed.payload).toEqual({ current: { income: huge, expense: '0.000000001', net: '-0' }, prior: { income: '0', expense: huge, net: '1.25' } });
    expectInvalid(row({ view_kind: 'project_totals', scope_kind: 'project', project_id: PROJECT_UUID, raw_reports: { current: 'x', prior: 'y' } }));
    for (const field of ['source_report', 'report_version', 'filters', 'settings']) {
      expectInvalid(row({ view_kind: 'project_totals', scope_kind: 'project', project_id: PROJECT_UUID, [field]: 'unexpected' }));
    }
    expectInvalid(row({ view_kind: 'project_totals', scope_kind: 'project', project_id: PROJECT_UUID,
      payload: { current: { income: '1', expense: '2', net: '3', account: 'private' }, prior: { income: '1', expense: '2', net: '3' } } }));
    expectInvalid(row({ view_kind: 'project_totals', scope_kind: 'project', project_id: PROJECT_UUID,
      payload: { current: { income: '1', expense: '2', net: '3' }, prior: { income: '1', expense: '2e', net: '3' } } }));
    for (const value of [1, 'NaN', 'Infinity', '1e', '+1', ' 1']) {
      expectInvalid(row({
        view_kind: 'project_totals', scope_kind: 'project', project_id: PROJECT_UUID,
        payload: { current: { income: value, expense: '0', net: '1' }, prior: { income: '0', expense: '0', net: '0' } },
      }));
    }
  });

  it('rejects impossible statement/scope/view combinations and keeps project totals scoped', () => {
    expectInvalid(row({ statement: 'trial_balance', scope_kind: 'project', project_id: PROJECT_UUID }));
    expectInvalid(row({ statement: 'balance_sheet', scope_kind: 'project', project_id: PROJECT_UUID }));
    expectInvalid(row({ scope_kind: 'company', view_kind: 'project_totals', project_id: null }));
    expectInvalid(row({ scope_kind: 'project', project_id: null }));
  });

  it('preserves safe JSON provenance, rejects malformed JSON/cycles, and never echoes injected values', () => {
    const futureShape = { futureNativeSetting: ['kept', { ratio: 1.25 }] };
    const accepted = parseFinancialStatementRow(row({ settings: futureShape }));
    expect(accepted.settings).toEqual(futureShape);
    const circular: { self?: unknown } = {}; circular.self = circular;
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, Symbol('x'), new Date(), circular]) {
      expectInvalid(row({ settings: { nested: [value] } }));
    }
    const injected = 'synthetic-never-echo-this-value';
    try { parseFinancialStatementRow({ ...row(), source_generation: injected }); throw new Error('Expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe('Invalid financial statement row.');
      expect((error as Error).message).not.toContain(injected);
    }
  });

  it('preserves display precision bounds, legacy modes and native-output provenance', () => {
    for (const display_precision of [0, 9]) {
      for (const display_rounding_method of ROUNDING_MODES) {
        const parsed = parseFinancialStatementRow(row({ display_precision, display_rounding_method }));
        expect(parsed.display_precision).toBe(display_precision);
        expect(parsed.display_rounding_method).toBe(display_rounding_method);
      }
    }
    expectInvalid(row({ display_precision: 2.5 }));
    expectInvalid(row({ display_precision: 10 }));
    expectInvalid(row({ display_rounding_method: 'Bankers Rounding' }));
    expectInvalid(row({ display_rounding_method: 'Unknown' }));
    const nativePresentation = { ...CATALOGUE, generation: { ...GENERATION, presentation: { precision: 2, roundingMethod: 'erpnext_report_output' } } };
    expect(parseFinancialStatementCatalogue(nativePresentation).generation?.presentation.roundingMethod).toBe('erpnext_report_output');
  });
});
