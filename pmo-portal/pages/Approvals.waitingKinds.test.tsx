import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ApprovalsPage from './Approvals';

// fix-waiting item 1: the inbox lists the kinds that come from the database's waiting read, counts them with the rest, and opens the page for
// a login whose only work is one of them. The other kinds are held empty so these kinds are the surface under test.
const h = vi.hoisted(() => ({
  role: 'Engineer',
  database: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  standing: { data: false as boolean | undefined, isPending: false, isError: false },
}));
const idle = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useWaitingDecisions', () => ({ useDatabaseWaiting: () => h.database, useDecisionStanding: () => h.standing }));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useWaitingForMe: () => idle, useMaterialRequest: () => ({ data: undefined }) }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalSection', () => ({ SalesInvoiceApprovalSection: () => null }));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => idle }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestAwaiting: () => ({ ...idle, data: { plans: [], replenishments: [] } }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useReopenableApprovedTimesheets: () => idle,
  useTimesheetsAwaitingApproval: () => idle,
  useTimesheetMutations: () => ({ approve: { mutate: vi.fn(), isPending: false }, settleBatch: vi.fn(), reject: { mutate: vi.fn(), isPending: false }, submit: { mutate: vi.fn(), isPending: false } }),
  usePushesNeedingAttention: () => ({ ...idle, retry: { mutate: vi.fn(), isPending: false } }),
  useEmployeeLinkConfirm: () => ({ links: idle, profiles: [], confirm: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ ...idle, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurementDetail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/hooks/useProcurementDetail')>();
  return { ...actual, useProcurementBulkTransition: () => ({ mutateAsync: vi.fn() }) };
});
vi.mock('./approvals/ProcurementApprovalRow', () => ({ ProcurementApprovalPreview: () => null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-me', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }), useOptionalRealRole: () => h.role }));

const row = (kind: string, recordId: string, title: string, createdAt: string) => ({ kind, recordId, projectId: null, title, createdAt });

const renderPage = (scope = 'all') => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  return render(
    <MemoryRouter initialEntries={[`/approvals?scope=${scope}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><ApprovalsPage /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  h.role = 'Engineer';
  h.database = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.standing = { data: false, isPending: false, isError: false };
});
afterEach(() => vi.unstubAllGlobals());

describe('the inbox lists the decisions the database says are waiting', () => {
  it('JOB-WAIT-1 a daily-report validator sees the report waiting, counted in All pending, opening the report', () => {
    h.role = 'Project Manager';
    h.database.data = [row('daily_report', 'd1', 'WO-7 · Slab · 2026-11-20', '2026-11-20T08:00:00Z'), row('work_order_issue', 'w1', 'WO-9 · Roof', '2026-11-21T08:00:00Z')];
    renderPage('all');
    const reports = screen.getByTestId('approvals-waiting-daily_report');
    expect(within(reports).getByText('Daily reports to validate (1)')).toBeInTheDocument();
    expect(within(reports).getByRole('link', { name: 'WO-7 · Slab · 2026-11-20' })).toHaveAttribute('href', '/site-reports/d1');
    expect(within(screen.getByTestId('approvals-waiting-work_order_issue')).getByRole('link', { name: 'WO-9 · Roof' })).toHaveAttribute('href', '/work-orders/w1');
    expect(within(screen.getByLabelText('Approvals scope')).getByText('All pending').closest('[role="tab"], button')).toHaveTextContent('2');
    expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
  });

  it('JOB-WAIT-1 a delivery to confirm has its own scope and shows alone', () => {
    h.role = 'Executive';
    h.database.data = [row('delivery_record', 'x1', 'Cement order', '2026-11-20T08:00:00Z'), row('daily_report', 'd1', 'Report', '2026-11-20T09:00:00Z')];
    renderPage('delivery_record');
    expect(screen.getByTestId('approvals-waiting-delivery_record')).toBeInTheDocument();
    expect(screen.queryByTestId('approvals-waiting-daily_report')).toBeNull();
    expect(screen.getByRole('link', { name: 'Cement order' })).toHaveAttribute('href', '/procurement/x1');
  });

  it('JOB-WAIT-1 a login whose only work is one of these kinds gets the page, not "no access"', () => {
    h.role = 'Engineer';
    h.database.data = [row('delivery_record', 'x1', 'Cement order', '2026-11-20T08:00:00Z')];
    renderPage('all');
    expect(screen.queryByText(/don't have access to approvals/i)).toBeNull();
    expect(screen.getByTestId('approvals-waiting-delivery_record')).toBeInTheDocument();
  });

  it('JOB-WAIT-1 a login with the standing to decide but nothing waiting reads "all caught up", not "no access"', () => {
    h.role = 'Engineer';
    h.standing = { data: true, isPending: false, isError: false };
    renderPage('all');
    expect(screen.queryByText(/don't have access to approvals/i)).toBeNull();
    expect(screen.getByTestId('approvals-caught-up')).toBeInTheDocument();
  });

  it('a failed read says so instead of a false "all caught up"', () => {
    h.role = 'Project Manager';
    h.database = { data: undefined as unknown as unknown[], isPending: false, isError: true, refetch: vi.fn() };
    renderPage('all');
    expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
  });
});
