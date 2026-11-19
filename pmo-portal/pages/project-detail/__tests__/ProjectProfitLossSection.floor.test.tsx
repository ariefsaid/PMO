import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { FinancialStatementCatalogue, FinancialStatementRead } from '@/src/lib/financialStatements';
import { repositories } from '@/src/lib/repositories';
import ProjectProfitLossSection from '../ProjectProfitLossSection';

// Same harness as ProjectProfitLossSection.test.tsx (host binding suite): the reads run
// through the real repository spy, only the data is faked.
vi.mock('@/src/hooks/useOdooLedger', () => ({ useOdooLedgerMode: () => ({ odoo: false, error: false, pending: false, retry: vi.fn() }) }));

const projectId = '33333333-3333-4333-8333-333333333333';
const monthPair = {
  kind: 'month' as const,
  currentStart: '2026-09-01',
  currentEnd: '2026-09-30',
  priorStart: '2026-08-01',
  priorEnd: '2026-08-31',
};
const augustPair = { ...monthPair, currentStart: '2026-08-01', currentEnd: '2026-08-31', priorStart: '2026-07-01', priorEnd: '2026-07-31' };
const quarterPair = {
  kind: 'quarter' as const,
  currentStart: '2026-07-01',
  currentEnd: '2026-09-30',
  priorStart: '2026-04-01',
  priorEnd: '2026-06-30',
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
  periods: [monthPair, augustPair, quarterPair],
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

/** Distinct figures per window so the shown values prove which read rendered. */
function readFor(periodStart: string): FinancialStatementRead {
  const pair = [monthPair, augustPair, quarterPair].find((p) => p.currentStart === periodStart)!;
  const figures = periodStart === '2026-08-01'
    ? { current: { income: '777.00', expense: '88.0', net: '689.000' }, prior: { income: '1.0', expense: '2.0', net: '-1.000' } }
    : periodStart === '2026-07-01'
      ? { current: { income: '900.00', expense: '300.0', net: '600.000' }, prior: { income: '3.0', expense: '4.0', net: '-1.000' } }
      : { current: { income: '101.00', expense: '202.0', net: '-303.000' }, prior: { income: '404.4', expense: '0.0', net: '505.55' } };
  return {
    state: 'complete',
    companyLabel: 'Company Must Not Appear',
    generation,
    selection: { periodKind: pair.kind, periodStart: pair.currentStart, statement: 'profit_and_loss', scopeKind: 'project', projectId, viewKind: 'project_totals' },
    result: {
      viewKind: 'project_totals',
      period: pair,
      hasActivity: true,
      payload: figures,
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
const readSpy = vi.spyOn(repositories.financialStatements, 'get').mockImplementation(async (input) => readFor(input.periodStart));

afterEach(() => vi.clearAllMocks());

describe('ProjectProfitLossSection floor', () => {
  it('floor: Period type switch re-reads the latest quarter window and shows its figures', async () => {
    renderSection();
    expect(await screen.findByText('101.00')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period type' }), 'quarter');
    await waitFor(() => expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ periodKind: 'quarter', periodStart: '2026-07-01', statement: 'profit_and_loss', projectId, viewKind: 'project_totals' }),
    ));
    expect(await screen.findByText('900.00')).toBeInTheDocument();
    expect(screen.getByText('300.0')).toBeInTheDocument();
    expect(screen.getByText('600.000')).toBeInTheDocument();
    expect(screen.queryByText('101.00')).not.toBeInTheDocument();
  });

  it('floor: Period picker selects the chosen month and its figures replace the default', async () => {
    renderSection();
    expect(await screen.findByText('101.00')).toBeInTheDocument();

    await act(async () => { catalogueSpy.mockResolvedValue({ ...catalogue, periods: [monthPair, augustPair] }); });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '2026-08-01');
    await waitFor(() => expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({ periodKind: 'month', periodStart: '2026-08-01', statement: 'profit_and_loss', projectId, viewKind: 'project_totals' }),
    ));
    expect(await screen.findByText('777.00')).toBeInTheDocument();
    expect(screen.getByText('88.0')).toBeInTheDocument();
    expect(screen.getByText('689.000')).toBeInTheDocument();
    expect(screen.queryByText('101.00')).not.toBeInTheDocument();
  });
});
