import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import { CompanyDashboard } from './CompanyDashboard';

type WorkOrderFixture = Pick<WorkOrderRow, 'id' | 'wo_number' | 'title' | 'status'> & {
  project_id?: WorkOrderRow['project_id'];
  project_name?: string | null;
};

const h = vi.hoisted(() => ({
  workOrders: {
    data: [] as WorkOrderFixture[] | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  role: 'Executive' as 'Executive' | 'Admin' | 'Finance',
}));

vi.mock('@/src/hooks/useWorkOrders', () => ({
  useAllWorkOrders: () => h.workOrders,
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: h.role }),
}));

vi.mock('@/src/components/dashboard/restructure/useCompanyFigures', () => ({
  useCompanyFigures: () => ({
    dashboard: {
      active_projects: 2,
      active_delivery_projects: 2,
      risk_unchecked_projects: 0,
      projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
      procurements_by_status: [],
      top_projects: [],
      attention_projects: [],
    },
    today: [{ id: 'contract-on-hand', label: 'Contract on hand', value: '$1,000', amounts: [{ currency: 'USD', amount: 1_000 }], href: '/projects' }],
    period: [],
    invoicedTrend: [],
    collectedByMonth: [],
    trendInvoicedByMonth: [],
    figureStatus: () => ({ pending: false, error: false, retry: vi.fn() }),
    dashboardPending: false,
    dashboardError: false,
    periodPending: false,
    periodError: false,
    todayPending: false,
    todayError: false,
    pipelinePending: false,
    pipelineError: false,
    trendPending: false,
    trendError: false,
    isEmpty: false,
    organizationToday: '2026-11-22',
    winRateRange: { from: '2026-01-01', to: '2026-12-31' },
    receivables: undefined,
    payables: undefined,
    receivablesPending: false,
    receivablesError: false,
    payablesPending: false,
    payablesError: false,
    leftToBillByProject: [],
    collectedPending: false,
    todayRetry: vi.fn(),
    periodRetry: vi.fn(),
    dashboardRetry: vi.fn(),
    pipelineRetry: vi.fn(),
    trendRetry: vi.fn(),
  }),
}));

vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => ({
    items: [],
    approvals: [],
    overdueInvoices: 0,
    approvalsPending: false,
    approvalsError: false,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/src/components/dashboard/restructure/usePeriod', () => ({
  usePeriod: () => ({
    period: { key: 'month' },
    selectPeriod: vi.fn(),
    setCustomMonth: vi.fn(),
  }),
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: {
      receivablesAgeing: {},
      payablesAgeing: {},
      overdue: [],
      receivablesUnknownCount: 0,
      receivablesNoDueDateCounts: {},
    },
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));

vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true }),
}));

vi.mock('@/src/components/dashboard/hub/company/financeData', () => ({
  useSupplierUnpaid: () => () => null,
  budgetSpendKnown: () => false,
}));

function renderDashboard(role: 'Executive' | 'Admin' | 'Finance') {
  h.role = role;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <CompanyDashboard role={role} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CompanyDashboard work orders entry (JOB-NAV-WO, Defect 4)', () => {
  beforeEach(() => {
    localStorage.removeItem('home-layout');
    h.workOrders = {
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  describe('Role and layout mounting', () => {
    it('mounts lawful WorkOrdersTile for Executive role in overview layout', () => {
      renderDashboard('Executive');
      const tile = screen.getByTestId('work-orders-tile');
      expect(tile).toBeInTheDocument();
      const grid = screen.getByTestId('home-grid');
      expect(grid).toContainElement(tile);
    });

    it('mounts lawful WorkOrdersTile for Admin role in overview layout', () => {
      renderDashboard('Admin');
      const tile = screen.getByTestId('work-orders-tile');
      expect(tile).toBeInTheDocument();
      const grid = screen.getByTestId('home-grid');
      expect(grid).toContainElement(tile);
    });

    it('mounts lawful WorkOrdersTile for Finance role in overview layout', () => {
      renderDashboard('Finance');
      const tile = screen.getByTestId('work-orders-tile');
      expect(tile).toBeInTheDocument();
      const grid = screen.getByTestId('home-grid');
      expect(grid).toContainElement(tile);
    });

    it('mounts WorkOrdersTile across all three roles in focused layout', () => {
      localStorage.setItem('home-layout', 'focused');

      const { unmount: unmountExec } = renderDashboard('Executive');
      expect(screen.getByTestId('work-orders-tile')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Work order' })).toBeInTheDocument();
      unmountExec();

      const { unmount: unmountAdmin } = renderDashboard('Admin');
      expect(screen.getByTestId('work-orders-tile')).toBeInTheDocument();
      unmountAdmin();

      renderDashboard('Finance');
      expect(screen.getByTestId('work-orders-tile')).toBeInTheDocument();
    });
  });

  describe('Tile content, links and filtering', () => {
    it('renders the dictionary term as title and links to /work-orders via See all', () => {
      renderDashboard('Executive');
      const tile = screen.getByTestId('work-orders-tile');
      expect(within(tile).getByRole('heading', { level: 2 })).toHaveTextContent('Work order');
      const seeAllLink = within(tile).getByRole('link', { name: 'See all' });
      expect(seeAllLink).toHaveAttribute('href', '/work-orders');
    });

    it('displays open Draft and Issued work orders with status pills and links to /work-orders/:id, omitting Closed/Cancelled', () => {
      h.workOrders.data = [
        { id: 'wo-1', wo_number: 'WO-101', title: 'Trenching Area A', status: 'Issued' },
        { id: 'wo-2', wo_number: 'WO-102', title: 'Paving Road', status: 'Draft' },
        { id: 'wo-0', wo_number: null, title: 'Unnumbered Survey', status: 'Draft' },
        { id: 'wo-3', wo_number: 'WO-103', title: 'Finished Piling', status: 'Closed' },
        { id: 'wo-4', wo_number: 'WO-104', title: 'Void Drainage', status: 'Cancelled' },
      ];

      renderDashboard('Executive');
      const tile = screen.getByTestId('work-orders-tile');

      // Issued order
      const issuedLink = within(tile).getByRole('link', { name: /WO-101 · Trenching Area A/ });
      expect(issuedLink).toHaveAttribute('href', '/work-orders/wo-1');
      expect(within(issuedLink).getByText('Issued')).toBeInTheDocument();

      // Draft order
      const draftLink = within(tile).getByRole('link', { name: /WO-102 · Paving Road/ });
      expect(draftLink).toHaveAttribute('href', '/work-orders/wo-2');
      expect(within(draftLink).getByText('Draft')).toBeInTheDocument();

      // Unnumbered order (nullable wo_number)
      const unnumberedLink = within(tile).getByRole('link', { name: 'Unnumbered Survey' });
      expect(unnumberedLink).toHaveAttribute('href', '/work-orders/wo-0');
      expect(within(unnumberedLink).getByText('Draft')).toBeInTheDocument();

      // Closed and Cancelled orders are filtered out from open list
      expect(within(tile).queryByText(/WO-103/)).not.toBeInTheDocument();
      expect(within(tile).queryByText(/WO-104/)).not.toBeInTheDocument();
    });
  });

  describe('Loading, error, and empty states on CompanyDashboard host', () => {
    it('renders empty copy when reader has no open work orders', () => {
      h.workOrders.data = [];
      renderDashboard('Finance');
      const tile = screen.getByTestId('work-orders-tile');
      expect(within(tile).getByText('No open work orders')).toBeInTheDocument();
    });

    it('renders loading state when work orders query is pending', () => {
      h.workOrders = {
        data: undefined,
        isPending: true,
        isError: false,
        refetch: vi.fn(),
      };
      renderDashboard('Admin');
      const tile = screen.getByTestId('work-orders-tile');
      expect(within(tile).getByTestId('liststate-loading')).toBeInTheDocument();
    });

    it('renders error state and invokes refetch on retry click when work orders query fails', async () => {
      const refetch = vi.fn();
      h.workOrders = {
        data: undefined,
        isPending: false,
        isError: true,
        refetch,
      };
      renderDashboard('Executive');
      const tile = screen.getByTestId('work-orders-tile');
      expect(within(tile).getByText("Couldn't load your work orders")).toBeInTheDocument();

      const retryBtn = within(tile).getByRole('button', { name: 'Retry' });
      await userEvent.click(retryBtn);
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });
});
