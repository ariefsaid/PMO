import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

const view = vi.hoisted(() => ({
  data: undefined as unknown,
  dashboardPending: false,
  dashboardError: false,
  pipeline: undefined as unknown,
  pipelinePending: false,
  pipelineError: false,
  procurements: [] as unknown[],
  procurementsPending: false,
  procurementsError: false,
  timesheets: [] as unknown[],
  timesheetsPending: false,
  timesheetsError: false,
  narrow: false,
}));

const dashboard = {
  active_projects: 2,
  total_contract_value: 8_000,
  total_contract_value_by_currency: { USD: 8_000 },
  on_hand_value: 10_000,
  on_hand_value_by_currency: [{
    currency: 'USD', contract_value: 10_000, actual_known: 5_000, contract_remaining: 5_000,
    actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 1_200, unknown_projects: 0,
  }],
  on_hand_contract_remaining: 5_000,
  on_hand_realized_margin: 1_200,
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 1_200, unknown_projects: 0 }],
  on_hand_actual_known: 5_000,
  on_hand_actual_project_count: 2,
  on_hand_actual_project_total: 2,
  on_hand_actual_coverage_count: 8,
  on_hand_actual_coverage_total: 8,
  on_hand_margin: 0.5,
  pipeline_total_value: 4_000,
  pipeline_total_value_by_currency: [{
    currency: 'USD', total_value: 4_000, weighted_value: 1_600, forecast_margin: 0.25, no_active_budget: 0,
  }],
  pipeline_weighted_value: 1_600,
  pipeline_projected_margin: 0.25,
  projects_at_risk: 1,
  active_delivery_projects: 2,
  risk_unchecked_projects: 1,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [{ status: 'Requested', count: 1 }, { status: 'Paid', count: 2 }],
  top_projects: [
    {
      id: 'p-alpha', name: 'Alpha', client_name: null, contract_value: 2_000, currency: 'USD',
      budget: 1_000, budget_currency: 'USD', spent: 500, actual_currency: 'USD', actual_complete: true,
      actual_coverage_count: 1, actual_coverage_total: 1, status: 'Ongoing Project',
    },
    {
      id: 'p-beta', name: 'Beta', client_name: null, contract_value: 3_000, currency: 'USD',
      budget: 1_000, budget_currency: 'USD', spent: 950, actual_currency: 'USD', actual_complete: true,
      actual_coverage_count: 1, actual_coverage_total: 1, status: 'Ongoing Project',
    },
    {
      id: 'p-gamma', name: 'Gamma', client_name: null, contract_value: 1_000, currency: 'USD',
      budget: 800, budget_currency: 'USD', spent: null, actual_currency: 'USD', actual_complete: false,
      actual_coverage_count: 0, actual_coverage_total: 1, status: 'Ongoing Project',
    },
  ],
};

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({
    data: view.data,
    isPending: view.dashboardPending,
    isError: view.dashboardError,
    refetch: vi.fn(),
  }),
  useSalesPipeline: () => ({
    data: view.pipeline,
    isPending: view.pipelinePending,
    isError: view.pipelineError,
    refetch: vi.fn(),
  }),
  useWinRate: () => ({
    data: {
      wins_count: 2, losses_count: 1, wins_value: 2_000, losses_value: 500,
      win_rate_count: 2 / 3, win_rate_value: 0.8,
    },
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: view.procurements,
    isPending: view.procurementsPending,
    isError: view.procurementsError,
  }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({
    data: view.timesheets,
    isPending: view.timesheetsPending,
    isError: view.timesheetsError,
  }),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({
  useProjectStatusLabel: () => (status: string) => status,
  useProcurementStatusLabel: () => (status: string) => status,
}));
vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => view.narrow }));
vi.mock('@/src/components/reports/BoardPackAction', () => ({
  BoardPackAction: () => <button type="button">Board pack</button>,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'exec-1', org_id: 'org-1' }, role: 'Executive' }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider><ExecutiveDashboard /></ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  view.data = dashboard;
  view.dashboardPending = false;
  view.dashboardError = false;
  view.pipeline = { stages: [{ status: 'Negotiation', count: 2, total_value: 2_000, win_probability: 0.4, weighted_value: 800 }] };
  view.pipelinePending = false;
  view.pipelineError = false;
  view.procurements = [];
  view.procurementsPending = false;
  view.procurementsError = false;
  view.timesheets = [];
  view.timesheetsPending = false;
  view.timesheetsError = false;
  view.narrow = false;
});

describe('Executive and Admin dashboard recomposition', () => {
  it('AC-806-EXEC-ORDER-001 keeps attention, delivery, invoiceable work, pipeline, and purchasing in target order', () => {
    renderPage();
    const attention = screen.getByRole('heading', { name: 'Attention and approvals' });
    const delivery = screen.getByRole('heading', { name: 'Delivery book' });
    const invoices = screen.getByRole('heading', { name: 'Still to invoice on work orders' });
    const pipeline = screen.getByRole('heading', { name: 'Pipeline' });
    const winRate = screen.getByRole('heading', { name: 'Win rate' });
    const purchasing = screen.getByText('Purchasing requests', { selector: 'summary' });
    expect(attention.compareDocumentPosition(delivery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(delivery.compareDocumentPosition(invoices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(invoices.compareDocumentPosition(pipeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pipeline.compareDocumentPosition(winRate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(winRate.compareDocumentPosition(purchasing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-806-EXEC-ACTION-001 chooses one risk action when approvals are known clear', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Review at-risk projects' })).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(screen.queryByRole('link', { name: 'Review requests' })).not.toBeInTheDocument();
  });

  it('AC-806-EXEC-ACTION-002 prioritizes known pending decisions and keeps alternatives quiet', () => {
    view.timesheets = [{ id: 'ts-1' }];
    renderPage();
    expect(screen.getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/approvals');
    expect(screen.queryByRole('link', { name: 'Review at-risk projects' })).not.toBeInTheDocument();
  });

  it('AC-806-EXEC-ACTION-003 names unavailable approvals and keeps a quiet inbox link', () => {
    view.procurementsError = true;
    renderPage();
    expect(screen.getByText('Approval status is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('link', { name: 'Review at-risk projects' })).toHaveAttribute('href', '/projects?filter=at-risk');
  });

  it('AC-806-EXEC-BOOK-001 shows scoped currency rows and keeps figure definitions disclosed', () => {
    renderPage();
    const delivery = screen.getByRole('region', { name: 'Delivery book' });
    expect(within(delivery).getAllByText('Contract value on hand')[0]).toBeInTheDocument();
    expect(within(delivery).getByText('10,000')).toBeInTheDocument();
    expect(within(delivery).getByRole('heading', { name: /Contract value on hand/ })).toBeInTheDocument();
    expect(within(delivery).getAllByText('Active contract value')[0]).toBeInTheDocument();
    expect(within(delivery).getAllByText('Known Actual')[0]).toBeInTheDocument();
    expect(within(delivery).getAllByText('Contract remaining after known Actual')).toHaveLength(2);
    expect(within(delivery).getAllByText('Margin on billed work').length).toBeGreaterThanOrEqual(2);
    expect(within(delivery).getByText('How figures are measured')).toBeInTheDocument();
  });

  it('AC-806-EXEC-HIERARCHY-001 sets one currency in each position head and keeps exact rows unit-free', () => {
    view.data = {
      ...dashboard,
      total_contract_value: null,
      on_hand_value: null,
      on_hand_value_by_currency: [
        dashboard.on_hand_value_by_currency[0],
        { currency: 'IDR', contract_value: 2_226_648_000, actual_known: null, contract_remaining: null, actual_coverage_count: 0, actual_coverage_total: 150, realized_margin_known: null, unknown_projects: 1 },
      ],
      on_hand_realized_margin_by_currency: [
        ...dashboard.on_hand_realized_margin_by_currency,
        { currency: 'IDR', known_amount: null, unknown_projects: 1 },
      ],
    };
    renderPage();
    const usd = screen.getByTestId('dashboard-delivery-position-USD');
    const idr = screen.getByTestId('dashboard-delivery-position-IDR');
    expect(usd.textContent?.match(/USD/g)).toHaveLength(1);
    expect(idr.textContent?.match(/IDR/g)).toHaveLength(1);
    expect(within(idr).getByText('2,226,648,000')).toBeInTheDocument();
    expect(within(usd).getByText('5,000')).toBeInTheDocument();
  });

  it('AC-806-EXEC-SPEND-001 puts known risk first, names unknown risk, and preserves the project destination', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'USD spending comparison' });
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Beta');
    expect(rows[0]).toContain('At risk');
    expect(rows[1]).toContain('Alpha');
    expect(rows[2]).toContain('Gamma');
    expect(rows[2]).toContain('Risk not checked');
    expect(within(table).getByRole('link', { name: 'Open Alpha' })).toHaveAttribute('href', '/projects/p-alpha');
  });

  it('AC-806-EXEC-PIPELINE-001 keeps margin, weighted and gross figures beside win rate and open-stage bars', () => {
    renderPage();
    const pipeline = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(pipeline).getByRole('heading', { name: /^Pipeline forecast margin/ })).toBeInTheDocument();
    expect(within(pipeline).getByRole('heading', { name: /Weighted pipeline/ })).toBeInTheDocument();
    expect(within(pipeline).getByText('1,600')).toBeInTheDocument();
    expect(within(pipeline).getByText('4,000')).toBeInTheDocument();
    expect(within(pipeline).getByRole('heading', { name: 'Win rate' })).toBeInTheDocument();
    expect(within(pipeline).getByRole('link', { name: 'Negotiation' })).toHaveAttribute('href', '/sales?status=Negotiation');
  });

  it('AC-806-EXEC-PURCHASING-001 keeps status drill links in the named disclosure', () => {
    renderPage();
    const disclosure = screen.getByText('Purchasing requests', { selector: 'summary' }).closest('details');
    expect(disclosure).not.toBeNull();
    expect(within(disclosure as HTMLElement).getByRole('link', { name: /Requested/ })).toHaveAttribute(
      'href', '/procurement?status=Requested',
    );
    expect(within(disclosure as HTMLElement).getByText(/Paid/)).toBeInTheDocument();
  });

  it('AC-806-EXEC-PHONE-001 reflows the same answer under one page heading', () => {
    view.narrow = true;
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Attention and approvals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delivery book' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board pack' })).toBeInTheDocument();
    const firstPosition = screen.getByTestId('dashboard-delivery-position-USD');
    const firstFigure = within(firstPosition).getByRole('heading', { name: /Contract value on hand/ });
    expect(firstFigure.compareDocumentPosition(within(firstPosition).getByText('10,000')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-806-EXEC-STATE-001 keeps the frame, invoiceable section, and pipeline when portfolio data fails', () => {
    view.data = undefined;
    view.dashboardError = true;
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Delivery book' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Still to invoice on work orders' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Win rate' })).toBeInTheDocument();
  });
});
