import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { FinancialStatementCatalogue, FinancialStatementPair, FinancialStatementRead } from '@/src/lib/financialStatements';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import type { NativeReportColumn } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { repositories } from '@/src/lib/repositories';
import FinancialStatements from '../FinancialStatements';

const projectId = '11111111-1111-4111-8111-111111111111';
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

function catalogue(scopesProject = true): FinancialStatementCatalogue {
  return {
    state: 'complete',
    companyLabel: 'Catalogue Company Label',
    generation,
    periods: pairs,
    scopes: [
      { scopeKind: 'company', projectId: null, statements: ['trial_balance', 'profit_and_loss', 'balance_sheet'], viewKinds: ['account_breakdown'] },
      ...(scopesProject ? [{ scopeKind: 'project' as const, projectId, statements: ['profit_and_loss' as const], viewKinds: ['account_breakdown' as const] }] : []),
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

function read(input: GetFinancialStatementInput, delayed = false): FinancialStatementRead {
  const pair = pairs.find((candidate) => candidate.kind === input.periodKind && candidate.currentStart === input.periodStart)!;
  return {
    state: 'complete',
    companyLabel: 'Read Company Label',
    generation: { ...generation, snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', delayed },
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

function renderPage(role = 'Finance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue(role)}>
        <ImpersonationProvider realRole={role as AuthContextValue['role']}>
          <MemoryRouter>
            <FinancialStatements />
          </MemoryRouter>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function requestedInputs(): GetFinancialStatementInput[] {
  return readSpy.mock.calls.map((call: unknown[]) => call[0] as GetFinancialStatementInput);
}

let catalogueSpy: ReturnType<typeof vi.spyOn>;
let readSpy: ReturnType<typeof vi.spyOn>;
let projectGetSpy: ReturnType<typeof vi.spyOn>;
let companyListSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  catalogueSpy = vi.spyOn(repositories.financialStatements, 'catalogue').mockResolvedValue(catalogue());
  readSpy = vi.spyOn(repositories.financialStatements, 'get').mockImplementation(async (input) => read(input));
  projectGetSpy = vi.spyOn(repositories.project, 'get').mockImplementation(async (id) => ({
    id,
    name: id === projectId ? 'Named delivery project' : 'Other admitted project',
    code: id === projectId ? 'PRJ-42' : 'PRJ-84',
  } as never));
  companyListSpy = vi.spyOn(repositories.company, 'list').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Financial statements company scope (AC-007)', () => {
  it('AC-007: uses the safe read context, mapped PMO names, and the supplied current/prior month pair', async () => {
    renderPage();

    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expect(screen.getByText('Prior native row')).toBeInTheDocument();
    expect(screen.getByText(/Read Company Label/)).toBeInTheDocument();
    expect(screen.queryByText('Catalogue Company Label')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Statement' })).toHaveValue('trial_balance');
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('2026-09-01');
    expect(screen.queryByRole('combobox', { name: 'Scope' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    expect(await screen.findByRole('combobox', { name: 'Scope' })).toBeInTheDocument();
    await waitFor(() => expect(projectGetSpy).toHaveBeenCalledTimes(1));
    expect(projectGetSpy).toHaveBeenCalledWith(projectId);
    expect(screen.getByRole('option', { name: /PRJ-42 · Named delivery project/ })).toBeInTheDocument();
    expect(companyListSpy).not.toHaveBeenCalled();

    const firstInput = readSpy.mock.calls[0]?.[0];
    expect(firstInput).toMatchObject({ periodKind: 'month', periodStart: '2026-09-01', statement: 'trial_balance', viewKind: 'account_breakdown' });
    expect(Object.hasOwn(firstInput ?? {}, 'unassigned')).toBe(false);
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it('AC-007 support: a failed mapped-name refresh retires the project choice while Company remains usable', async () => {
    const { client } = renderPage();
    await screen.findByText('Current native row');
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    await screen.findByRole('option', { name: /PRJ-42 · Named delivery project/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: projectId } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId, statement: 'profit_and_loss' })));
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue(projectId);
    expect(screen.getByText('Current native row')).toBeInTheDocument();

    projectGetSpy.mockRejectedValue(new Error('private project lookup failure'));
    await client.invalidateQueries({ queryKey: ['financial-statements', 'mapped-project-name'] });

    expect(await screen.findByText(/Some mapped project names are unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Named delivery project/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Current native row')).not.toBeInTheDocument();
    expect(screen.queryByText('private project lookup failure')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('');
    expect(requestedInputs().filter((input) => input.projectId === projectId)).toHaveLength(1);

    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: 'company' } });
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'profit_and_loss' }));
  });

  it('AC-007: quarter and fiscal-year selections use catalogue ranges and BS as-at ends without deriving dates', async () => {
    renderPage();
    await screen.findByText('Current native row');

    fireEvent.change(screen.getByRole('combobox', { name: 'Period type' }), { target: { value: 'quarter' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ periodKind: 'quarter', periodStart: '2026-04-01' })));
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'balance_sheet' } });
    expect(await screen.findAllByText(/As at/)).toHaveLength(2);
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      periodKind: 'quarter', periodStart: '2026-04-01', statement: 'balance_sheet', viewKind: 'account_breakdown',
    }));
    expect(screen.getByText(/As at Jun 30, 2026/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Period type' }), { target: { value: 'fiscal_year' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ periodKind: 'fiscal_year', periodStart: '2026-04-01' })));
  });

  it('AC-008 support: delayed complete reads retry the same selection and retain the saved window and values during a failed refresh', async () => {
    let rejectRefresh: ((error: Error) => void) | undefined;
    readSpy
      .mockImplementationOnce(async (input: GetFinancialStatementInput) => read(input, true))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    renderPage();

    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expect(screen.getByText('Prior native row')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    const captureWindow = screen.getByText(/Capture window:/).textContent;
    const callsBeforeRetry = readSpy.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(callsBeforeRetry + 1));
    expect(await screen.findByText(/Refreshing statements/)).toBeVisible();
    expect(screen.getByText('Current native row')).toBeInTheDocument();
    expect(screen.getByText('Prior native row')).toBeInTheDocument();
    expect(screen.getByText(captureWindow ?? '')).toBeInTheDocument();

    await act(async () => { rejectRefresh?.(new Error('private refresh failure')); });
    await waitFor(() => expect(screen.getByText('Update delayed')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.getByText('Current native row')).toBeInTheDocument();
    expect(screen.getByText('Prior native row')).toBeInTheDocument();
    expect(screen.getByText(captureWindow ?? '')).toBeInTheDocument();
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      periodKind: 'month', periodStart: '2026-09-01', statement: 'trial_balance', viewKind: 'account_breakdown',
    }));
    expect(screen.queryByText('private refresh failure')).not.toBeInTheDocument();
  });

  it('AC-007: switching mapped-project P&L to TB atomically returns to Company and never requests project TB', async () => {
    renderPage();
    await screen.findByText('Current native row');
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'profit_and_loss' })));
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: projectId } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId, statement: 'profit_and_loss', viewKind: 'account_breakdown' })));

    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'trial_balance' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'trial_balance' })));
    expect(requestedInputs().some((input) => input.projectId === projectId && input.statement === 'trial_balance')).toBe(false);
    expect(screen.queryByRole('combobox', { name: 'Scope' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'profit_and_loss' })));
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('company');
    expect(screen.queryByText('Native Mapped Project')).not.toBeInTheDocument();
  });

  it('AC-007: a catalogue refresh removing the selected project clears its content without broadening to Company', async () => {
    const { client } = renderPage();
    await screen.findByText('Current native row');
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'profit_and_loss' })));
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: projectId } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId, statement: 'profit_and_loss' })));

    catalogueSpy.mockResolvedValue(catalogue(false));
    await client.invalidateQueries({
      queryKey: ['financial-statements'],
      predicate: (query) => query.queryKey.includes('catalogue'),
    });
    await waitFor(() => expect(screen.queryByText('Current native row')).not.toBeInTheDocument());
    expect(requestedInputs().filter((input) => input.projectId === projectId)).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('');
  });

  it('AC-007: a denied direct link renders calm denial copy and makes no statement or project request', async () => {
    renderPage('Project Manager');
    expect(await screen.findByText("You don't have access to financial statements")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeInTheDocument();
    expect(catalogueSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(projectGetSpy).not.toHaveBeenCalled();
  });
});
