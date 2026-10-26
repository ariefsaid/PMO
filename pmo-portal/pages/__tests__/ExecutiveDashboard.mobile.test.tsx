import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

const populated = {
  active_projects: 18,
  active_delivery_projects: 18,
  risk_unchecked_projects: 0,
  total_contract_value: 23_050_000,
  on_hand_margin: 0.224,
  on_hand_value: 26_650_000,
  on_hand_contract_remaining: 22_000_000,
  on_hand_realized_margin: 4_650_000,
  on_hand_actual_known: 4_000_000,
  on_hand_actual_project_count: 18,
  on_hand_actual_project_total: 18,
  on_hand_actual_coverage_count: 18,
  on_hand_actual_coverage_total: 18,
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 4_650_000, unknown_projects: 0 }],
  on_hand_value_by_currency: [{
    currency: 'USD', contract_value: 26_650_000, actual_known: 4_650_000,
    contract_remaining: 22_000_000, actual_coverage_count: 18, actual_coverage_total: 18,
    realized_margin_known: 4_650_000, unknown_projects: 0,
  }],
  pipeline_weighted_value: 8_400_000,
  pipeline_projected_margin: 0.315,
  pipeline_total_value: 19_200_000,
  pipeline_total_value_by_currency: [{ currency: 'USD', total_value: 19_200_000, weighted_value: 8_400_000, forecast_margin: 0.315, no_active_budget: 0 }],
  projects_at_risk: 3,
  projects_by_status: [{ status: 'Ongoing Project', count: 18 }],
  procurements_by_status: [{ status: 'Draft', count: 1 }, { status: 'Requested', count: 2 }],
  top_projects: [{
    id: 'p1', name: 'Alpha Project', client_name: 'ACME', contract_value: 5_000_000, currency: 'USD',
    budget: 4_700_000, budget_currency: 'USD', spent: 2_100_000, actual_currency: 'USD',
    actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, status: 'Ongoing Project',
  }],
};

const dashboardState = vi.hoisted(() => ({
  data: null as unknown,
  pending: false,
  error: false,
  approvals: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Array<{ id: string }>,
  effectiveRole: 'Executive',
}));

vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/reports/BoardPackAction', () => ({ BoardPackAction: () => null }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dashboardState.data, isPending: dashboardState.pending, isError: dashboardState.error, refetch: vi.fn() }),
  useWinRate: () => ({
    data: { wins_count: 2, losses_count: 1, wins_value: 8_000_000, losses_value: 650_000, win_rate_count: 2 / 3, win_rate_value: 0.92 },
    isPending: false, isError: false,
  }),
  useSalesPipeline: () => ({
    data: { stages: [{ status: 'Tender Submitted', count: 1, total_value: 1_000_000, win_probability: 0.3, weighted_value: 300_000 }] },
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: dashboardState.effectiveRole, realRole: dashboardState.effectiveRole }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: [],
    isPending: false, isError: false,
  }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: dashboardState.approvals, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/src/components/dashboard/FinanceDashboard', () => ({ FinanceDashboard: () => <div data-testid="role-finance" /> }));
vi.mock('@/src/components/dashboard/PMDashboard', () => ({ PMDashboard: () => <div data-testid="role-pm" /> }));
vi.mock('@/src/components/dashboard/EngineerDashboard', () => ({ EngineerDashboard: () => <div data-testid="role-engineer" /> }));

const renderPage = () => render(
  <MemoryRouter><ToastProvider><ExecutiveDashboard /></ToastProvider></MemoryRouter>,
);

beforeEach(() => {
  dashboardState.data = populated;
  dashboardState.pending = false;
  dashboardState.error = false;
  dashboardState.approvals = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  dashboardState.effectiveRole = 'Executive';
});

describe('Executive dashboard uses one responsive composition', () => {
  it('keeps one accessible risk, approval, and Delivery book representation', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Executive Dashboard' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('dashboard-attention')).toHaveTextContent('3 projects at risk');
    expect(screen.getByTestId('dashboard-attention')).toHaveTextContent('3 approval requests need a decision');
    expect(screen.getByRole('region', { name: 'Delivery book' })).toHaveTextContent('Contract value on hand');
    expect(screen.getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/approvals');
    expect(container.querySelectorAll('[data-testid="dashboard-delivery-book"]')).toHaveLength(1);
  });

  it('shows complete per-currency figures and project-specific drill-throughs', () => {
    dashboardState.data = {
      ...populated,
      on_hand_value: null,
      on_hand_value_by_currency: [
        { currency: 'IDR', contract_value: 2_000_000_000, actual_known: 1_200_000_000, contract_remaining: 800_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 100_000_000, unknown_projects: 0 },
        { currency: 'USD', contract_value: 1_000_000, actual_known: null, contract_remaining: null, actual_coverage_count: 0, actual_coverage_total: 2, realized_margin_known: null, unknown_projects: 1 },
      ],
      on_hand_realized_margin_by_currency: [
        { currency: 'IDR', known_amount: 100_000_000, unknown_projects: 0 },
        { currency: 'USD', known_amount: null, unknown_projects: 1 },
      ],
    };
    dashboardState.approvals = [];
    renderPage();
    const delivery = screen.getByRole('region', { name: 'Delivery book' });
    expect(delivery).toHaveTextContent('IDR');
    expect(delivery).toHaveTextContent('USD');
    expect(delivery).toHaveTextContent(/2,000,000,000/);
    expect(delivery).toHaveTextContent(/1,000,000/);
    expect(screen.getByRole('link', { name: 'Review at-risk projects' })).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(screen.getByRole('link', { name: 'Open Alpha Project' })).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByRole('link', { name: 'Tender Submitted' })).toHaveAttribute('href', '/sales?status=Tender%20Submitted');
  });

  it('keeps unknown risk and approval status distinct from a confirmed zero', () => {
    dashboardState.data = {
      ...populated,
      active_delivery_projects: 2,
      risk_unchecked_projects: 2,
      projects_at_risk: 0,
      top_projects: [{ ...populated.top_projects[0]!, budget: null, spent: null, actual_complete: false }],
    };
    dashboardState.approvals = [];
    renderPage();
    expect(screen.getByText('Risk is not checked for 2 delivery projects')).toBeInTheDocument();
    expect(screen.queryByText('No projects at risk')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review at-risk projects' })).not.toBeInTheDocument();
  });

  it('renders loading and error recovery in the same page frame', () => {
    dashboardState.data = null;
    dashboardState.pending = true;
    const { unmount } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Executive Dashboard' })).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-delivery-book')).toBeInTheDocument();
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    unmount();

    dashboardState.pending = false;
    dashboardState.error = true;
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Executive Dashboard' })).toBeInTheDocument();
    const deliveryBook = screen.getByTestId('dashboard-delivery-book');
    expect(within(deliveryBook).getByText(/Couldn't load the dashboard/i)).toBeInTheDocument();
    expect(within(deliveryBook).getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it.each([
    ['Finance', 'role-finance'],
    ['Project Manager', 'role-pm'],
    ['Engineer', 'role-engineer'],
  ])('routes the %s role to its dashboard body', (role, testId) => {
    dashboardState.effectiveRole = role;
    renderPage();
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('routes Admin through the shared Executive dashboard composition', () => {
    dashboardState.effectiveRole = 'Admin';
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Executive Dashboard' })).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-delivery-book')).toBeInTheDocument();
  });
});
