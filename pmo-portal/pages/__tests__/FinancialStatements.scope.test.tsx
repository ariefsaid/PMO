import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import { financeTestI18n, financeTestI18nReady } from '@/test/financeI18nTestInstance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { FinancialStatementCatalogue, FinancialStatementPair, FinancialStatementRead } from '@/src/lib/financialStatements';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import type { NativeReportColumn } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { repositories } from '@/src/lib/repositories';
import FinancialStatements from '../FinancialStatements';

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

function catalogue(scopesProject = true): FinancialStatementCatalogue {
  return {
    state: 'complete',
    companyLabel: 'Catalogue Company Label',
    generation,
    periods: pairs,
    scopes: [
      { scopeKind: 'company', projectId: null, statements: ['trial_balance', 'profit_and_loss', 'balance_sheet'], viewKinds: ['account_breakdown'] },
      ...(scopesProject ? [projectId, otherProjectId].map((id) => ({ scopeKind: 'project' as const, projectId: id, statements: ['profit_and_loss' as const], viewKinds: ['account_breakdown' as const] })) : []),
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

function renderPage(role = 'Finance', localized = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue(role)}>
        <ImpersonationProvider realRole={role as AuthContextValue['role']}>
          <MemoryRouter>
            {localized ? <I18nextProvider i18n={financeTestI18n}><FinancialStatements /></I18nextProvider> : <FinancialStatements />}
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
  projectGetSpy = vi.spyOn(repositories.project, 'getMany').mockImplementation(async (ids) => ids.map((id) => ({
    id,
    name: id === projectId ? 'Named delivery project' : 'Other admitted project',
    short_name: id === projectId ? 'North Terminal' : null,
    code: id === projectId ? 'PRJ-42' : 'PRJ-84',
  } as never)));
  companyListSpy = vi.spyOn(repositories.company, 'list').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The trial balance shows one period at a time (statement format); its period switch reaches the
// previous period's saved rows and returns to the current period.
function expectBothTrialBalancePeriods() {
  expect(screen.getByText('Current native row')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
  expect(screen.getByText('Prior native row')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Current period' }));
  expect(screen.getByText('Current native row')).toBeInTheDocument();
}

describe('Financial statements company scope (AC-007)', () => {
  it('C1: a failed project-name read preserves the selected scope and retries that read', async () => {
    const { client } = renderPage();
    await screen.findByText('Current native row');
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    await screen.findByRole('option', { name: /PRJ-42 · North Terminal/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: projectId } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId, statement: 'profit_and_loss' })));

    projectGetSpy.mockRejectedValueOnce(new Error('private project lookup failure'));
    await client.invalidateQueries({ queryKey: ['financial-statements', 'mapped-project-name'] });

    await waitFor(() => expect(projectGetSpy).toHaveBeenCalledTimes(2));
    const errorTitle = await screen.findByText("Couldn't load the selected project's name");
    const error = errorTitle.closest('[role="alert"]');
    expect(error).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue(projectId);
    projectGetSpy.mockResolvedValue([{ id: projectId, name: 'Named delivery project', short_name: 'North Terminal', code: 'PRJ-42' } as never]);
    await userEvent.click(within(error!).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue(projectId);
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId, statement: 'profit_and_loss' }));
    expect(projectGetSpy).toHaveBeenCalledTimes(3);
  });

  it('AC-007: uses the safe read context, mapped PMO names, and the supplied current/prior month pair', async () => {
    renderPage();

    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expectBothTrialBalancePeriods();
    expect(screen.getByText(/Read Company Label/)).toBeInTheDocument();
    expect(screen.queryByText('Catalogue Company Label')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Statement' })).toHaveValue('trial_balance');
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('2026-09-01');
    expect(screen.queryByRole('combobox', { name: 'Scope' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    expect(await screen.findByRole('combobox', { name: 'Scope' })).toBeInTheDocument();
    await waitFor(() => expect(projectGetSpy).toHaveBeenCalledTimes(1));
    // one batched label read for every admitted project, not one request per project
    expect(projectGetSpy).toHaveBeenCalledWith([projectId, otherProjectId]);
    expect(screen.getByRole('option', { name: 'PRJ-42 · North Terminal' })).toBeInTheDocument();
    expect(companyListSpy).not.toHaveBeenCalled();

    const firstInput = readSpy.mock.calls[0]?.[0];
    expect(firstInput).toMatchObject({ periodKind: 'month', periodStart: '2026-09-01', statement: 'trial_balance', viewKind: 'account_breakdown' });
    expect(Object.hasOwn(firstInput ?? {}, 'unassigned')).toBe(false);
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it('AC-007 support: a failed mapped-name refresh keeps the project scope and Company remains usable', async () => {
    const { client } = renderPage();
    await screen.findByText('Current native row');
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'profit_and_loss' } });
    await screen.findByRole('option', { name: /PRJ-42 · North Terminal/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: projectId } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ projectId, statement: 'profit_and_loss' })));
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue(projectId);
    expect(screen.getByText('Current native row')).toBeInTheDocument();

    projectGetSpy.mockRejectedValue(new Error('private project lookup failure'));
    await client.invalidateQueries({ queryKey: ['financial-statements', 'mapped-project-name'] });

    await waitFor(() => expect(screen.queryByRole('option', { name: /Named delivery project/ })).not.toBeInTheDocument());
    expect(screen.queryByText('Current native row')).not.toBeInTheDocument();
    expect(screen.queryByText('private project lookup failure')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue(projectId);
    const projectNameErrorTitle = await screen.findByText("Couldn't load the selected project's name");
    const projectNameError = projectNameErrorTitle.closest('[role="alert"]');
    expect(projectNameError).not.toBeNull();
    expect(within(projectNameError!).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(requestedInputs().filter((input) => input.projectId === projectId)).toHaveLength(1);

    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: 'company' } });
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ statement: 'profit_and_loss' }));
  });

  // #1930: an accepted "Refresh now" must refetch the statement read so republished figures
  // replace the stale ones without a manual reload; non-accepted responses must not refetch.
  it('#1930: an accepted Refresh now refetches the statement read and renders the republished figure', async () => {
    vi.spyOn(repositories.financialStatements, 'refreshNow').mockResolvedValue('accepted');
    renderPage();
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    const callsBeforeRefresh = readSpy.mock.calls.length;

    // The sweep published new figures while the screen was showing the stale read.
    readSpy.mockImplementation(async (input: GetFinancialStatementInput) => {
      const next = read(input) as FinancialStatementRead & {
        result: { payload: { current: { rows: Array<Record<string, string>> } } };
      };
      next.result.payload.current.rows = [{ account: 'Republished native row', closing_debit: '7654321.00' }];
      return next;
    });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(callsBeforeRefresh + 1));
    expect(await screen.findByText('Republished native row')).toBeVisible();
    expect(screen.queryByText('Current native row')).not.toBeInTheDocument();
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      periodKind: 'month', periodStart: '2026-09-01', statement: 'trial_balance', viewKind: 'account_breakdown',
    }));
  });

  it('#1930: a coalesced Refresh now leaves the statement read untouched', async () => {
    vi.spyOn(repositories.financialStatements, 'refreshNow').mockResolvedValue('coalesced');
    renderPage();
    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    const callsBeforeRefresh = readSpy.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByText('A refresh was requested recently.')).toBeVisible();
    expect(readSpy).toHaveBeenCalledTimes(callsBeforeRefresh);
    expect(screen.getByText('Current native row')).toBeVisible();
  });

  // The acceptance only bumps the org's refresh intent (available_at is +5 minutes); the sweep
  // republishes later, so the page polls the statement read until the published generation
  // changes or the ~10-minute cap passes. 30s interval, 10-minute cap.
  function republishedRead(input: GetFinancialStatementInput): FinancialStatementRead {
    const next = read(input) as FinancialStatementRead & {
      generation: { asOf: string; snapshotId: string };
      result: { payload: { current: { rows: Array<Record<string, string>> } } };
    };
    next.generation.asOf = '2026-10-17T14:00:00.000Z';
    next.generation.snapshotId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    next.result.payload.current.rows = [{ account: 'Republished native row', closing_debit: '7654321.00' }];
    return next;
  }

  it('#1930: an accepted Refresh now polls the read and stops once the republished figure renders', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.spyOn(repositories.financialStatements, 'refreshNow').mockResolvedValue('accepted');
      renderPage();
      expect(await screen.findByText('Current native row')).toBeInTheDocument();
      const callsAfterLoad = readSpy.mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      expect(await screen.findByText('Refresh requested. New figures appear shortly.')).toBeInTheDocument();
      // Accepted refetches immediately, but the sweep has not republished yet.
      await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(callsAfterLoad + 1));
      expect(screen.getByText('Current native row')).toBeInTheDocument();

      // First poll tick: same published generation, so the screen keeps the old figure and keeps polling.
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(readSpy).toHaveBeenCalledTimes(callsAfterLoad + 2);
      expect(screen.getByText('Current native row')).toBeInTheDocument();

      // The sweep publishes; the next poll renders the new figure and stops polling.
      readSpy.mockImplementation(async (input: GetFinancialStatementInput) => republishedRead(input));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(readSpy).toHaveBeenCalledTimes(callsAfterLoad + 3);
      expect(await screen.findByText('Republished native row')).toBeInTheDocument();
      expect(screen.queryByText('Current native row')).not.toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(readSpy).toHaveBeenCalledTimes(callsAfterLoad + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('#1930: statement polling after an accepted Refresh now stops at the cap even when nothing changed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.spyOn(repositories.financialStatements, 'refreshNow').mockResolvedValue('accepted');
      renderPage();
      expect(await screen.findByText('Current native row')).toBeInTheDocument();
      const callsAfterLoad = readSpy.mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(callsAfterLoad + 1));

      // The whole 10-minute window polls (immediate refetch plus one per 30s tick), then stops.
      await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
      const callsAtCap = readSpy.mock.calls.length;
      expect(callsAtCap).toBeGreaterThan(callsAfterLoad + 1);

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(readSpy).toHaveBeenCalledTimes(callsAtCap);
      expect(screen.getByText('Current native row')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('#1930: coalesced and unavailable Refresh now responses never poll the statement read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const refreshNowSpy = vi.spyOn(repositories.financialStatements, 'refreshNow');
      refreshNowSpy.mockResolvedValue('coalesced');
      renderPage();
      expect(await screen.findByText('Current native row')).toBeInTheDocument();
      const callsAfterLoad = readSpy.mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      expect(await screen.findByText('A refresh was requested recently.')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(readSpy).toHaveBeenCalledTimes(callsAfterLoad);

      refreshNowSpy.mockResolvedValue('unavailable');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
      expect(await screen.findByText('Refresh is not available yet.')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(readSpy).toHaveBeenCalledTimes(callsAfterLoad);
      expect(screen.getByText('Current native row')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-007: quarter and fiscal-year selections use catalogue ranges and BS as-at ends without deriving dates', async () => {
    renderPage();
    await screen.findByText('Current native row');

    fireEvent.change(screen.getByRole('combobox', { name: 'Period type' }), { target: { value: 'quarter' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ periodKind: 'quarter', periodStart: '2026-04-01' })));
    fireEvent.change(screen.getByRole('combobox', { name: 'Statement' }), { target: { value: 'balance_sheet' } });
    expect(await screen.findByText(/As at 30 Jun 2026/)).toBeInTheDocument();
    expect(screen.getAllByText(/As at/)).toHaveLength(1);
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      periodKind: 'quarter', periodStart: '2026-04-01', statement: 'balance_sheet', viewKind: 'account_breakdown',
    }));
    expect(screen.getByRole('table')).toHaveAccessibleName(/As at 30 Jun 2026/);

    fireEvent.change(screen.getByRole('combobox', { name: 'Period type' }), { target: { value: 'fiscal_year' } });
    await waitFor(() => expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({ periodKind: 'fiscal_year', periodStart: '2026-04-01' })));
  });

  it('AC-008 support: delayed complete reads retry the same selection and retain the saved update time and values during a failed refresh', async () => {
    let rejectRefresh: ((error: Error) => void) | undefined;
    readSpy
      .mockImplementationOnce(async (input: GetFinancialStatementInput) => read(input, true))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    renderPage();

    expect(await screen.findByText('Current native row')).toBeInTheDocument();
    expectBothTrialBalancePeriods();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    const updated = screen.getByTestId('snapshot-provenance').textContent;
    const callsBeforeRetry = readSpy.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(callsBeforeRetry + 1));
    expect(await screen.findByText(/Refreshing statements/)).toBeVisible();
    expectBothTrialBalancePeriods();
    expect(screen.getByTestId('snapshot-provenance')).toHaveTextContent(updated ?? '');

    await act(async () => { rejectRefresh?.(new Error('private refresh failure')); });
    await waitFor(() => expect(screen.getByText('Update delayed')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expectBothTrialBalancePeriods();
    expect(screen.getByTestId('snapshot-provenance')).toHaveTextContent(updated ?? '');
    expect(readSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      periodKind: 'month', periodStart: '2026-09-01', statement: 'trial_balance', viewKind: 'account_breakdown',
    }));
    expect(screen.queryByText('private refresh failure')).not.toBeInTheDocument();
  });

  it('AC-008 support: company profit and loss preserves both native sides and source labels in Bahasa', async () => {
    await financeTestI18nReady;
    await financeTestI18n.changeLanguage('id');
    try {
      catalogueSpy.mockResolvedValue(catalogue(false));
      renderPage('Finance', true);
      await screen.findByText('Current native row');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Laporan' }), 'profit_and_loss');
      expect(await screen.findByText('Prior native row')).toBeVisible();
      expect(screen.getAllByRole('table')).toHaveLength(1);
      expect(screen.getAllByText('Current native row')).toHaveLength(1);
      expect(screen.getByText('Current native row')).toBeVisible();
      expect(screen.getByRole('columnheader', { name: /Periode berjalan/ })).toBeVisible();
      expect(screen.getByRole('columnheader', { name: /Periode sebelumnya/ })).toBeVisible();
      expect(screen.queryByRole('combobox', { name: 'Cakupan' })).not.toBeInTheDocument();
    } finally {
      await financeTestI18n.changeLanguage('en');
    }
  });

  it('AC-008 support: initial read error hides backend detail and Retry restores the report', async () => {
    readSpy.mockRejectedValueOnce(new Error('Private backend details must stay hidden.'));
    renderPage();
    expect(await screen.findByText("Couldn't load financial statements")).toBeVisible();
    expect(screen.queryByText('Private backend details must stay hidden.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Current native row')).toBeVisible();
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it('AC-008 support: keyboard order stays period kind, period, statement, then Retry', async () => {
    readSpy.mockRejectedValue(new Error('Read failed'));
    catalogueSpy.mockResolvedValue(catalogue(false));
    renderPage();
    const statement = await screen.findByRole('combobox', { name: 'Statement' });
    await userEvent.selectOptions(statement, 'profit_and_loss');
    await screen.findByRole('button', { name: 'Retry' });
    screen.getByRole('combobox', { name: 'Period type' }).focus();
    await userEvent.tab();
    expect(screen.getByRole('combobox', { name: /^Period$/ })).toHaveFocus();
    await userEvent.tab();
    expect(statement).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
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
    // With no project admitted any more there is nothing to scope; the cleared content stays cleared.
    expect(screen.queryByRole('combobox', { name: 'Scope' })).not.toBeInTheDocument();
    expect(screen.queryByText('Current native row')).not.toBeInTheDocument();
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

