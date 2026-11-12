import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { FinancialStatementCatalogue, FinancialStatementPair, FinancialStatementRead } from '@/src/lib/financialStatements';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import type { NativeReportColumn } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { repositories } from '@/src/lib/repositories';
import FinancialStatements from '../FinancialStatements';

/**
 * R2 (ux/1110): the statement controls (statement kind, period type/start) live in the URL, so
 * a Balance-Sheet/quarter view survives a refresh and a shared link reproduces it.
 */

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '22222222-2222-4222-8222-222222222222';
const generation = {
  snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceGeneration: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  asOf: '2026-10-17T13:00:00.000Z',
  captureStartedAt: '2026-10-17T12:00:00.000Z',
  captureCompletedAt: '2026-10-17T13:00:00.000Z',
  currency: 'IDR' as const,
  presentation: { precision: 2, roundingMethod: 'Commercial Rounding' as const },
  delayed: false,
};
const pairs: FinancialStatementPair[] = [
  { kind: 'month', currentStart: '2026-08-01', currentEnd: '2026-08-31', priorStart: '2026-07-01', priorEnd: '2026-07-31' },
  { kind: 'month', currentStart: '2026-09-01', currentEnd: '2026-09-30', priorStart: '2026-08-01', priorEnd: '2026-08-31' },
  { kind: 'quarter', currentStart: '2026-04-01', currentEnd: '2026-06-30', priorStart: '2026-01-01', priorEnd: '2026-03-31' },
  { kind: 'fiscal_year', currentStart: '2026-04-01', currentEnd: '2027-03-31', priorStart: '2025-04-01', priorEnd: '2026-03-31' },
];

function catalogue(): FinancialStatementCatalogue {
  return {
    state: 'complete',
    companyLabel: 'Catalogue Company Label',
    generation,
    periods: pairs,
    scopes: [
      { scopeKind: 'company', projectId: null, statements: ['trial_balance', 'profit_and_loss', 'balance_sheet'], viewKinds: ['account_breakdown'] },
      ...[projectId, otherProjectId].map((id) => ({ scopeKind: 'project' as const, projectId: id, statements: ['profit_and_loss' as const], viewKinds: ['account_breakdown' as const] })),
    ],
  };
}

function nativeReport(
  side: 'current' | 'prior',
  input: GetFinancialStatementInput,
): NativeReportColumn {
  const pair = pairs.find((candidate) => candidate.kind === input.periodKind && candidate.currentStart === input.periodStart)!;
  const period = side === 'current'
    ? { fromDate: pair.currentStart, toDate: pair.currentEnd, fromFiscalYear: 'FY 2026', toFiscalYear: 'FY 2027', kind: input.periodKind === 'fiscal_year' ? 'year' as const : input.periodKind }
    : { fromDate: pair.priorStart, toDate: pair.priorEnd, fromFiscalYear: 'FY 2025', toFiscalYear: 'FY 2026', kind: input.periodKind === 'fiscal_year' ? 'year' as const : input.periodKind };
  const currentPeriod = { ...period, fromDate: pair.currentStart, toDate: pair.currentEnd };
  const priorPeriod = { ...period, fromDate: pair.priorStart, toDate: pair.priorEnd };
  const reportName = input.statement === 'trial_balance' ? 'Trial Balance'
    : input.statement === 'balance_sheet' ? 'Balance Sheet' : 'Profit and Loss Statement';
  return {
    reportName,
    company: 'Native Company',
    side,
    period,
    periodPair: { current: currentPeriod, prior: priorPeriod },
    project: input.projectId ? { projectId: input.projectId, erpProjectName: 'Native Mapped Project' } : null,
    language: 'en',
    profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
    columns: [
      { fieldname: 'account', label: 'Account', type: 'text' },
      { fieldname: 'closing_debit', label: 'Closing Debit', type: 'currency' },
    ],
    rows: [{ account: side === 'current' ? 'Current native row' : 'Prior native row', closing_debit: side === 'current' ? '1234567.00' : '7654321.00' }],
    summary: null,
    provenance: {
      endpoint: '/api/method/frappe.desk.query_report.run',
      method: 'GET',
      ignorePreparedReport: 1,
      rawSha256: 'a'.repeat(64),
      acquiredAt: side === 'current' ? '2026-10-17T12:30:00.000Z' : '2026-10-17T12:31:00.000Z',
      filters: {},
    },
  } as unknown as NativeReportColumn;
}

function read(input: GetFinancialStatementInput): FinancialStatementRead {
  const pair = pairs.find((candidate) => candidate.kind === input.periodKind && candidate.currentStart === input.periodStart)!;
  return {
    state: 'complete',
    companyLabel: 'Read Company Label',
    generation: { ...generation, snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    selection: {
      periodKind: input.periodKind,
      periodStart: input.periodStart,
      statement: input.statement,
      scopeKind: input.projectId ? 'project' : 'company',
      projectId: input.projectId ?? null,
      viewKind: 'account_breakdown',
    },
    result: {
      viewKind: 'account_breakdown',
      period: pair,
      hasActivity: true,
      payload: { current: nativeReport('current', input), prior: nativeReport('prior', input) },
      provenance: { sourceReport: 'Trial Balance', reportVersion: '16.33.0', filters: null, settings: null },
    },
  } as FinancialStatementRead;
}

const authValue = (role: string): AuthContextValue => ({
  session: { user: { id: 'user-1' } } as Session,
  currentUser: { id: 'user-1', org_id: 'org-1', role, status: 'active' } as AuthContextValue['currentUser'],
  role: role as AuthContextValue['role'],
  loading: false,
  profileError: null,
  profileErrorKind: null,
  signInWithPassword: vi.fn(),
  signInWithMagicLink: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  resendEmailConfirmation: vi.fn(),
  signOut: vi.fn(),
  refreshCurrentUser: vi.fn(),
});

function LocationProbe() {
  return <div data-testid="location-probe" data-search={useLocation().search} />;
}

function renderPage(initialEntry = '/finance/statements') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue('Finance')}>
        <ImpersonationProvider realRole="Finance">
          <MemoryRouter initialEntries={[initialEntry]}>
            <FinancialStatements />
            <LocationProbe />
          </MemoryRouter>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

let readSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(repositories.financialStatements, 'catalogue').mockResolvedValue(catalogue());
  readSpy = vi.spyOn(repositories.financialStatements, 'get').mockImplementation(async (input) => read(input));
  vi.spyOn(repositories.project, 'getMany').mockImplementation(async (ids) => ids.map((id) => ({
    id,
    name: 'Named delivery project',
    short_name: id === projectId ? 'North Terminal' : null,
    code: id === projectId ? 'PRJ-42' : 'PRJ-84',
  } as never)));
  vi.spyOn(repositories.company, 'list').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('R2 — statement controls live in the URL', () => {
  it('a refresh of ?statement=balance_sheet reopens the balance sheet', async () => {
    renderPage('/finance/statements?statement=balance_sheet');
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Statement' })).toHaveValue('balance_sheet');
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'balance_sheet', periodKind: 'month' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?statement=balance_sheet');
  });

  it('a refresh of ?periodKind=quarter reopens the quarter view', async () => {
    renderPage('/finance/statements?periodKind=quarter');
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('2026-04-01');
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ periodKind: 'quarter', periodStart: '2026-04-01' }));
  });

  it('switching the statement writes it into the URL (the default stays out)', async () => {
    renderPage('/finance/statements');
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    // fireEvent is the established select-driving pattern on this page (see scope.test.tsx):
    // the FormGrid selects sit under overlay-ready wrappers that swallow pointer events.
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'balance_sheet' } });
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?statement=balance_sheet');
  });
});
