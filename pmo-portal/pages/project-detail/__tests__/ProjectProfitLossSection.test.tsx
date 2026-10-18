import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { FinancialStatementCatalogue, FinancialStatementRead } from '@/src/lib/financialStatements';
import { repositories } from '@/src/lib/repositories';
import ProjectProfitLossSection from '../ProjectProfitLossSection';

const projectId = '33333333-3333-4333-8333-333333333333';
const period = {
  kind: 'month' as const,
  currentStart: '2026-09-01',
  currentEnd: '2026-09-30',
  priorStart: '2026-08-01',
  priorEnd: '2026-08-31',
};
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
const catalogue: FinancialStatementCatalogue = {
  state: 'complete',
  companyLabel: 'Company Must Not Appear',
  generation,
  periods: [period],
  scopes: [{ scopeKind: 'project', projectId, statements: ['profit_and_loss'], viewKinds: ['account_breakdown', 'project_totals'] }],
};

const authValue: AuthContextValue = {
  session: { user: { id: 'staff-1' } } as Session,
  currentUser: { id: 'staff-1', org_id: 'org-1', role: 'Project Manager', status: 'active' } as AuthContextValue['currentUser'],
  role: 'Project Manager' as AuthContextValue['role'],
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
};

function totalsRead(delayed = false): FinancialStatementRead {
  return {
    state: 'complete',
    companyLabel: 'Company Must Not Appear',
    generation: { ...generation, delayed },
    selection: { periodKind: 'month', periodStart: period.currentStart, statement: 'profit_and_loss', scopeKind: 'project', projectId, viewKind: 'project_totals' },
    result: {
      viewKind: 'project_totals',
      period,
      hasActivity: true,
      payload: {
        current: { income: '101.00', expense: '202.0', net: '-303.000' },
        prior: { income: '404.4', expense: '0.0', net: '505.55' },
      },
    },
  };
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue}>
        <ImpersonationProvider realRole="Project Manager">
          <ProjectProfitLossSection projectId={projectId} />
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const catalogueSpy = vi.spyOn(repositories.financialStatements, 'catalogue').mockResolvedValue(catalogue);
const readSpy = vi.spyOn(repositories.financialStatements, 'get').mockResolvedValue(totalsRead());
const projectGetSpy = vi.spyOn(repositories.project, 'get');
const companyListSpy = vi.spyOn(repositories.company, 'list');

afterEach(() => vi.clearAllMocks());

describe('ProjectProfitLossSection host binding', () => {
  it('AC-009 support: PM overview reads exactly the restricted native project totals and renders only their six values', async () => {
    renderSection();

    expect(await screen.findByText('101.00')).toBeInTheDocument();
    expect(screen.getByText('202.0')).toBeInTheDocument();
    expect(screen.getByText('-303.000')).toBeInTheDocument();
    expect(screen.getByText('404.4')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('505.55')).toBeInTheDocument();
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));
    expect(readSpy).toHaveBeenCalledWith({
      periodKind: 'month', periodStart: period.currentStart, statement: 'profit_and_loss', projectId, viewKind: 'project_totals',
    });
    expect(screen.queryByText('Company Must Not Appear')).not.toBeInTheDocument();
    expect(screen.queryByText(/account|rawSha|filter/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Statement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Scope' })).not.toBeInTheDocument();
    expect(projectGetSpy).not.toHaveBeenCalled();
    expect(companyListSpy).not.toHaveBeenCalled();
    expect(catalogueSpy).toHaveBeenCalledWith({ projectId });
  });

  it('AC-008 support: Retry reruns only the active project totals read and retains its window and six exact values after refresh failure', async () => {
    let rejectRefresh: ((error: Error) => void) | undefined;
    readSpy
      .mockImplementationOnce(async () => totalsRead(true))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    renderSection();

    expect(await screen.findByText('101.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    const captureWindow = screen.getByText(/Capture window:/).textContent;
    const readsBeforeRetry = readSpy.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(readsBeforeRetry + 1));
    expect(await screen.findByText(/Refreshing statements/)).toBeVisible();
    for (const value of ['101.00', '202.0', '-303.000', '404.4', '0.0', '505.55']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText(captureWindow ?? '')).toBeInTheDocument();

    await act(async () => { rejectRefresh?.(new Error('private refresh failure')); });
    await waitFor(() => expect(screen.getByText('Update delayed')).toBeVisible());
    for (const value of ['101.00', '202.0', '-303.000', '404.4', '0.0', '505.55']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText(captureWindow ?? '')).toBeInTheDocument();
    expect(readSpy).toHaveBeenLastCalledWith({
      periodKind: 'month', periodStart: period.currentStart, statement: 'profit_and_loss', projectId, viewKind: 'project_totals',
    });
    expect(screen.queryByText('private refresh failure')).not.toBeInTheDocument();
  });
});
