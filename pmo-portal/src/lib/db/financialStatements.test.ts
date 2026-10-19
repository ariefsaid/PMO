import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { AppError } from '@/src/lib/appError';
import { getFinancialStatement, getFinancialStatementCatalogue } from './financialStatements';

const PROJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const GENERATION_A = {
  snapshotId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sourceGeneration: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  asOf: '2024-03-01T12:34:56.000Z', captureStartedAt: '2024-03-01T12:30:00.000Z',
  captureCompletedAt: '2024-03-01T12:34:56.000Z', currency: 'IDR',
  presentation: { precision: 2, roundingMethod: 'Commercial Rounding' }, delayed: true,
};
const GENERATION_B = { ...GENERATION_A, snapshotId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' };
const PAIR = { kind: 'month', currentStart: '2024-02-01', currentEnd: '2024-02-29', priorStart: '2024-01-01', priorEnd: '2024-01-31' };
const SELECTION = {
  periodKind: 'month', periodStart: '2024-02-01', statement: 'profit_and_loss',
  scopeKind: 'company', projectId: null, viewKind: 'account_breakdown',
};
function nativeReport(side: 'current' | 'prior') {
  const period = side === 'current'
    ? { fromDate: '2024-02-01', toDate: '2024-02-29', fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: 'month', columnLabel: 'Feb 2024' }
    : { fromDate: '2024-01-01', toDate: '2024-01-31', fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: 'month', columnLabel: 'Jan 2024' };
  return {
    reportName: 'Profit and Loss Statement', company: 'Synthetic Company', side, period,
    periodPair: {
      current: { fromDate: '2024-02-01', toDate: '2024-02-29', fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: 'month', columnLabel: 'Feb 2024' },
      prior: { fromDate: '2024-01-01', toDate: '2024-01-31', fromFiscalYear: 'FY24', toFiscalYear: 'FY24', kind: 'month', columnLabel: 'Jan 2024' },
    },
    project: null, language: 'en', profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
    columns: [{ fieldname: 'account', label: 'Account', type: 'text' }], rows: [], summary: null,
    provenance: {
      endpoint: '/api/method/frappe.desk.query_report.run', method: 'GET', ignorePreparedReport: 1,
      rawSha256: 'a'.repeat(64), acquiredAt: '2024-03-01T12:34:00.000Z', filters: {},
    },
  };
}
const CATALOGUE = {
  state: 'complete', companyLabel: 'Synthetic Company', generation: GENERATION_A,
  periods: [PAIR],
  scopes: [{ scopeKind: 'company', projectId: null, statements: ['profit_and_loss'], viewKinds: ['account_breakdown'] }],
};
const READ = {
  state: 'complete', companyLabel: 'Synthetic Company', generation: GENERATION_A, selection: SELECTION,
  result: {
    viewKind: 'account_breakdown', period: PAIR, hasActivity: true,
    payload: { current: nativeReport('current'), prior: nativeReport('prior') },
    provenance: { sourceReport: 'Profit and Loss Statement', reportVersion: '16.33.0', filters: { current: {}, prior: {} }, settings: {} },
  },
};
const INPUT = { periodKind: 'month', periodStart: '2024-02-01', statement: 'profit_and_loss' } as const;

function rpc(data: unknown, error: unknown = null) {
  h.rpc.mockResolvedValueOnce({ data, error });
}

beforeEach(() => h.rpc.mockReset());

describe('financial statement DAL', () => {
  it('AC-006 catalogue sends only the exact optional project argument and strictly parses its envelope', async () => {
    rpc(CATALOGUE);
    await expect(getFinancialStatementCatalogue()).resolves.toEqual(CATALOGUE);
    expect(h.rpc).toHaveBeenCalledWith('get_financial_statement_catalogue', { p_project_id: null });

    rpc(CATALOGUE);
    await getFinancialStatementCatalogue({ projectId: PROJECT.toUpperCase() });
    expect(h.rpc).toHaveBeenLastCalledWith('get_financial_statement_catalogue', { p_project_id: PROJECT });
  });

  it('AC-006 performs catalogue then exact read with normalized defaults and returns matching full pair', async () => {
    rpc(CATALOGUE);
    rpc(READ);
    await expect(getFinancialStatement(INPUT)).resolves.toEqual(READ);
    expect(h.rpc.mock.calls).toEqual([
      ['get_financial_statement_catalogue', { p_project_id: null }],
      ['get_financial_statement', {
        p_period_kind: 'month', p_period_start: '2024-02-01', p_statement: 'profit_and_loss',
        p_project_id: null, p_view_kind: 'account_breakdown', p_unassigned: false,
      }],
    ]);
  });

  it('AC-006 preserves project selection and retries both RPCs once after any tuple mismatch', async () => {
    const projectInput = { ...INPUT, projectId: PROJECT, viewKind: 'project_totals' as const };
    const projectSelection = { ...SELECTION, scopeKind: 'project', projectId: PROJECT, viewKind: 'project_totals' };
    const projectCatalogue = {
      ...CATALOGUE,
      scopes: [{ scopeKind: 'project', projectId: PROJECT, statements: ['profit_and_loss'], viewKinds: ['project_totals'] }],
    };
    const projectRead = {
      ...READ, selection: projectSelection,
      result: { viewKind: 'project_totals', period: PAIR, hasActivity: false,
        payload: { current: { income: '0', expense: '0', net: '0' }, prior: { income: '0', expense: '0', net: '0' } } },
    };
    rpc(projectCatalogue);
    rpc({ ...projectRead, generation: GENERATION_B });
    const retryCatalogue = { ...projectCatalogue, generation: GENERATION_B };
    rpc(retryCatalogue);
    rpc({ ...projectRead, generation: GENERATION_B });

    await expect(getFinancialStatement(projectInput)).resolves.toEqual({ ...projectRead, generation: GENERATION_B });
    expect(h.rpc).toHaveBeenCalledTimes(4);
    expect(h.rpc.mock.calls[0]).toEqual(['get_financial_statement_catalogue', { p_project_id: PROJECT }]);
    expect(h.rpc.mock.calls[1]?.[1]).toEqual({
      p_period_kind: 'month', p_period_start: '2024-02-01', p_statement: 'profit_and_loss',
      p_project_id: PROJECT, p_view_kind: 'project_totals', p_unassigned: false,
    });
    expect(h.rpc.mock.calls[2]).toEqual(h.rpc.mock.calls[0]);
    expect(h.rpc.mock.calls[3]).toEqual(h.rpc.mock.calls[1]);
  });

  it('AC-006 treats the capture window as part of generation identity before and after retry', async () => {
    const laterCapture = { ...GENERATION_A, captureStartedAt: '2024-03-01T12:31:00.000Z' };
    rpc(CATALOGUE);
    rpc({ ...READ, generation: laterCapture });
    rpc(CATALOGUE);
    rpc(READ);
    await expect(getFinancialStatement(INPUT)).resolves.toEqual(READ);
    expect(h.rpc).toHaveBeenCalledTimes(4);
  });

  it('AC-006 stops with a neutral changed-snapshot error after the one permitted retry', async () => {
    rpc(CATALOGUE);
    rpc({ ...READ, generation: GENERATION_B });
    rpc(CATALOGUE);
    rpc({ ...READ, generation: GENERATION_B });
    await expect(getFinancialStatement(INPUT)).rejects.toMatchObject({
      code: 'statement-snapshot-changed', message: 'Statement data changed while it was being read. Please try again.',
    });
    expect(h.rpc).toHaveBeenCalledTimes(4);
  });

  it('AC-006 accepts unavailable only when both generation identities are absent', async () => {
    const unavailable = { state: 'unavailable', companyLabel: null, generation: null, periods: [], scopes: [] };
    const unavailableRead = { state: 'unavailable', companyLabel: null, generation: null, selection: SELECTION, result: null };
    rpc(unavailable);
    rpc(unavailableRead);
    await expect(getFinancialStatement(INPUT)).resolves.toEqual(unavailableRead);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it('AC-006 stops immediately on transport, permission and malformed successful responses', async () => {
    rpc(null, { message: 'not permitted', code: '42501' });
    await expect(getFinancialStatementCatalogue()).rejects.toMatchObject({ code: '42501' });
    expect(h.rpc).toHaveBeenCalledTimes(1);

    h.rpc.mockReset();
    rpc({ unexpected: true });
    await expect(getFinancialStatementCatalogue()).rejects.toMatchObject({ code: 'statement-invalid-response' });
    expect(h.rpc).toHaveBeenCalledTimes(1);

    h.rpc.mockReset();
    rpc(CATALOGUE);
    rpc(null, { message: 'denied', code: '42501' });
    await expect(getFinancialStatement(INPUT)).rejects.toBeInstanceOf(AppError);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it('AC-006 rejects extras and invalid input before sending widened RPC arguments', async () => {
    await expect(getFinancialStatementCatalogue({ projectId: PROJECT, company: 'forged' } as never)).rejects.toMatchObject({ code: 'statement-invalid-input' });
    await expect(getFinancialStatement({ ...INPUT, orgId: PROJECT } as never)).rejects.toMatchObject({ code: 'statement-invalid-input' });
    await expect(getFinancialStatement({ ...INPUT, periodStart: '2024-02-30' })).rejects.toMatchObject({ code: 'statement-invalid-input' });
    await expect(getFinancialStatement({ ...INPUT, projectId: PROJECT, statement: 'balance_sheet' })).rejects.toMatchObject({ code: 'statement-invalid-input' });
    await expect(getFinancialStatement({ ...INPUT, viewKind: 'project_totals' })).rejects.toMatchObject({ code: 'statement-invalid-input' });
    await expect(getFinancialStatement({ ...INPUT, unassigned: true } as never)).rejects.toMatchObject({ code: 'statement-invalid-input' });
    await expect(getFinancialStatement({ ...INPUT, unassigned: true, viewKind: 'project_totals' } as never)).rejects.toMatchObject({ code: 'statement-invalid-input' });
    await expect(getFinancialStatement({ ...INPUT, projectId: PROJECT, unassigned: true } as never)).rejects.toMatchObject({ code: 'statement-invalid-input' });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('AC-006 retries a complete read when its exact period pair is absent from the catalogue', async () => {
    const otherPair = { kind: 'month', currentStart: '2024-03-01', currentEnd: '2024-03-31', priorStart: '2024-02-01', priorEnd: '2024-02-29' };
    rpc({ ...CATALOGUE, periods: [otherPair] });
    rpc(READ);
    rpc(CATALOGUE);
    rpc(READ);
    await expect(getFinancialStatement(INPUT)).resolves.toEqual(READ);
    expect(h.rpc).toHaveBeenCalledTimes(4);
  });
});
