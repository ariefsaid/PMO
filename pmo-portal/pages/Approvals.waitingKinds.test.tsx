import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
  // The client-acceptance (BAST) waiting read: its own caller-filtered source (1570), never `delivery_record`.
  bast: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  standing: { data: false as boolean | undefined, isPending: false, isError: false },
  leave: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    enabled: true,
    prerequisitePending: false,
    prerequisiteError: false,
    refetch: vi.fn(),
  },
  imprest: {
    data: { plans: [] as unknown[], replenishments: [] as unknown[] },
    isPending: false,
    isError: false,
    enabled: true,
    refetch: vi.fn(),
  },
}));
const idle = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useWaitingDecisions', () => ({ useDatabaseWaiting: () => h.database, useDecisionStanding: () => h.standing }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({ useAcceptancesAwaitingConfirmation: () => h.bast }));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useWaitingForMe: () => idle, useMaterialRequest: () => ({ data: undefined }) }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalSection', () => ({ SalesInvoiceApprovalSection: () => null }));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => idle }));
vi.mock('@/src/hooks/useLeave', () => ({ useLeaveRequests: () => h.leave }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestAwaiting: () => h.imprest }));
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
  h.bast = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.standing = { data: false, isPending: false, isError: false };
  h.leave = {
    data: [],
    isPending: false,
    isError: false,
    enabled: true,
    prerequisitePending: false,
    prerequisiteError: false,
    refetch: vi.fn(),
  };
  h.imprest = {
    data: { plans: [], replenishments: [] },
    isPending: false,
    isError: false,
    enabled: true,
    refetch: vi.fn(),
  };
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

  // JOB-PM-7 (waiting half): Finance/Admin discover a client acceptance (BAST) in the same inbox that counts it, and a
  // confirmed one leaves the item and the list — the section is gone, not a cached zero row.
  const bastRow = {
    id: 'acc-1', project_id: 'p1', work_order_id: 'wo-9', acceptance_date: '2026-11-20',
    is_final: false, prepared_by: 'pm-1', prepared_at: '2026-11-20T08:00:00Z',
  };

  it('JOB-PM-7 Finance finds the waiting client acceptance in the inbox and opens its exact work order', () => {
    h.role = 'Finance';
    h.bast = { data: [bastRow], isPending: false, isError: false, refetch: vi.fn() };
    renderPage('work_order_acceptance');
    const section = screen.getByTestId('approvals-waiting-work_order_acceptance');
    expect(within(section).getByText('Client acceptances to confirm (1)')).toBeInTheDocument();
    const link = within(section).getByRole('link', { name: /Client acceptance \(stage\) of/ });
    expect(link).toHaveAttribute('href', '/work-orders/wo-9');
    expect(link.getAttribute('href')).not.toContain('acc-1');
  });

  it('JOB-PM-7 once the acceptance is confirmed the shared list no longer carries it (no cached zero row)', () => {
    h.role = 'Finance';
    h.bast = { data: [bastRow], isPending: false, isError: false, refetch: vi.fn() };
    renderPage('all');
    expect(screen.getByTestId('approvals-waiting-work_order_acceptance')).toBeInTheDocument();
    cleanup();
    h.bast = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    renderPage('all');
    expect(screen.queryByTestId('approvals-waiting-work_order_acceptance')).toBeNull();
  });

  describe('approvals-knownness: unread or failed sources withhold all-caught-up and counts', () => {
    it('applicable leave pending with zero rows prevents all-caught-up, withholds count, and is present in extraKinds', () => {
      h.role = 'Project Manager';
      h.leave = {
        data: [],
        isPending: true,
        isError: false,
        enabled: true,
        prerequisitePending: false,
        prerequisiteError: false,
        refetch: vi.fn(),
      };
      renderPage('all');
      expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
      const scopeToggle = screen.getByLabelText('Approvals scope');
      expect(within(scopeToggle).getByText('Leave requests')).toBeInTheDocument();
      const allTab = within(scopeToggle).getByText('All pending').closest('[role="tab"], button');
      expect(within(allTab!).queryByText('0')).toBeNull();
    });

    it('applicable leave error with zero rows prevents all-caught-up, withholds count, and is present in extraKinds', () => {
      h.role = 'Project Manager';
      h.leave = {
        data: [],
        isPending: false,
        isError: true,
        enabled: true,
        prerequisitePending: false,
        prerequisiteError: false,
        refetch: vi.fn(),
      };
      renderPage('all');
      expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
      const scopeToggle = screen.getByLabelText('Approvals scope');
      expect(within(scopeToggle).getByText('Leave requests')).toBeInTheDocument();
      const allTab = within(scopeToggle).getByText('All pending').closest('[role="tab"], button');
      expect(within(allTab!).queryByText('0')).toBeNull();
    });

    it('applicable imprest pending with zero rows prevents all-caught-up, withholds count, and is present in extraKinds', () => {
      h.role = 'Finance';
      h.imprest = {
        data: { plans: [], replenishments: [] },
        isPending: true,
        isError: false,
        enabled: true,
        refetch: vi.fn(),
      };
      renderPage('all');
      expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
      const scopeToggle = screen.getByLabelText('Approvals scope');
      expect(within(scopeToggle).getByText('Site cash')).toBeInTheDocument();
      const allTab = within(scopeToggle).getByText('All pending').closest('[role="tab"], button');
      expect(within(allTab!).queryByText('0')).toBeNull();
    });

    it('applicable imprest error with zero rows prevents all-caught-up, withholds count, and is present in extraKinds', () => {
      h.role = 'Finance';
      h.imprest = {
        data: { plans: [], replenishments: [] },
        isPending: false,
        isError: true,
        enabled: true,
        refetch: vi.fn(),
      };
      renderPage('all');
      expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
      const scopeToggle = screen.getByLabelText('Approvals scope');
      expect(within(scopeToggle).getByText('Site cash')).toBeInTheDocument();
      const allTab = within(scopeToggle).getByText('All pending').closest('[role="tab"], button');
      expect(within(allTab!).queryByText('0')).toBeNull();
    });

    it('settled empty: all sources settled with zero rows renders all-caught-up', () => {
      h.role = 'Finance';
      h.leave = { data: [], isPending: false, isError: false, enabled: true, prerequisitePending: false, prerequisiteError: false, refetch: vi.fn() };
      h.imprest = { data: { plans: [], replenishments: [] }, isPending: false, isError: false, enabled: true, refetch: vi.fn() };
      h.database = { data: [], isPending: false, isError: false, refetch: vi.fn() };
      h.bast = { data: [], isPending: false, isError: false, refetch: vi.fn() };
      renderPage('all');
      expect(screen.getByTestId('approvals-caught-up')).toBeInTheDocument();
    });

    it('known rows from independent source: leave row settles with known count and prevents all-caught-up', () => {
      h.role = 'Project Manager';
      h.leave = {
        data: [{ id: 'l-1', can_decide: true, start_date: '2026-11-20T00:00:00Z', notes: 'Medical leave' }],
        isPending: false,
        isError: false,
        enabled: true,
        prerequisitePending: false,
        prerequisiteError: false,
        refetch: vi.fn(),
      };
      renderPage('all');
      expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
      const scopeToggle = screen.getByLabelText('Approvals scope');
      expect(within(scopeToggle).getByText('Leave requests')).toBeInTheDocument();
      const allTab = within(scopeToggle).getByText('All pending').closest('[role="tab"], button');
      expect(within(allTab!).getByText('1')).toBeInTheDocument();
    });

    it('known rows from independent source: imprest plan settles with known count and prevents all-caught-up', () => {
      h.role = 'Finance';
      h.imprest = {
        data: {
          plans: [{
            id: 'plan-1',
            month: '2026-11-01',
            total: '500000',
            submitted_at: '2026-11-20T00:00:00Z',
            float_id: 'float-1',
            status: 'Submitted',
            float: {
              custodian_id: 'other-user',
              currency: 'IDR',
              project: { name: 'Apollo' },
            },
          }],
          replenishments: [],
        },
        isPending: false,
        isError: false,
        enabled: true,
        refetch: vi.fn(),
      };
      renderPage('all');
      expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
      const scopeToggle = screen.getByLabelText('Approvals scope');
      expect(within(scopeToggle).getByText('Site cash')).toBeInTheDocument();
      const allTab = within(scopeToggle).getByText('All pending').closest('[role="tab"], button');
      expect(within(allTab!).getByText('1')).toBeInTheDocument();
    });
  });
});
