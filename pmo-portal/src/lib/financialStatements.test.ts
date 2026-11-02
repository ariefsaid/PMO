import { describe, expect, expectTypeOf, it } from 'vitest';
import type { StatementReportPair } from './adapterSeam/erpnext/statementReports';
import {
  parseFinancialStatementCatalogue,
  parseFinancialStatementRead,
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
