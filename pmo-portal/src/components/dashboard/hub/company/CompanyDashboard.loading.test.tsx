/**
 * Loading gates (A1–A15): every region of the company home is drawn from its own read. One slow read never holds
 * the other regions' figures, and one failed read is said where it failed (never blank, never 0) while the others
 * still show theirs.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';
import { useCheckInRequests } from '@/src/hooks/usePhoneCheckIn';

const dash = {
  active_projects: 2, active_delivery_projects: 2, risk_unchecked_projects: 0,
  on_hand_value: 8_000_000, on_hand_contract_remaining: 6_000_000, on_hand_realized_margin: null,
  on_hand_realized_margin_by_currency: [],
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8_000_000, actual_known: 2_000_000, contract_remaining: 6_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: null, unknown_projects: 0 }],
  on_hand_actual_coverage_count: 2, on_hand_actual_coverage_total: 2,
  pipeline_projected_margin: null, projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }], procurements_by_status: [], top_projects: [],
  attention_projects: [{ id: 'p1', name: 'River project', short_name: null, client_name: null, contract_value: 100, currency: 'USD', budget: 1_000, spent: 500, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD', status: 'Ongoing Project', attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: 0.5 }],
};
const month = `${new Date().getFullYear()}-01`;
const pack = { from: `${month}-01`, to: `${month}-01`, timezone: 'UTC', undatedInvoiceCount: 0, months: [`${month}-01`], rows: [], totals: [{ currency: 'USD', months: [{ month: `${month}-01`, invoiced: 120_000_000 }] }] };
const invoice = { id: 'i1', customer_name: 'Client One', si_number: 'INV-1', status: 'Unpaid', currency: 'USD', invoice_date: '2026-01-01', erp_due_date: '2026-01-31', received_date: null, erp_outstanding_amount: 40_000, erp_payment_terms_days: 30 };

type Read = { data: unknown; isPending: boolean; isError: boolean };
const ok = (data: unknown): Read => ({ data, isPending: false, isError: false });
const pending: Read = { data: undefined, isPending: true, isError: false };
const failed: Read = { data: undefined, isPending: false, isError: true };
const h = vi.hoisted(() => ({
  reads: {} as Record<string, { data: unknown; isPending: boolean; isError: boolean }>,
  role: 'Executive' as 'Executive' | 'Admin' | 'Finance',
  managementViews: false,
  portfolioIds: [] as string[][],
  projectListEnabled: false,
  checkInRequests: () => Promise.resolve([] as unknown[]),
}));
const read = (name: string) => {
  const result = h.reads[name] ?? ok({});
  return { ...result, isLoading: result.isPending, refetch: vi.fn() };
};

vi.mock('@/src/lib/repositories/phoneCheckIn', () => ({
  phoneCheckInRepository: {
    requests: () => h.checkInRequests(),
  },
}));

vi.mock('@/src/hooks/useWaitingForYou', () => ({
  useWaitingForYou: () => ({
    entries: [],
    count: 0,
    countFor: () => 0,
    pendingKinds: [],
    failedKinds: [],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => read('salesInvoices'),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useOverdueInvoiceFacts: () => read('invoices'),
  usePaidPaymentFacts: () => read('payments'),
  useHasAnySalesInvoice: () => ({ data: true, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: true, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => read('pack') }));
vi.mock('@/src/lib/db/dashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/dashboard')>()),
  getExecutiveDashboard: async () => dash,
  getFinanceBudgetReview: () => Promise.resolve([]),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => read('dashboard'),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useProjectsDelivery')>()),
  useProjectsDelivery: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectManagementOverview: (ids: string[]) => { h.portfolioIds.push(ids); return read('portfolioMilestones'); },
  useProjectsDeliverySummary: (ids: string[]) => { h.portfolioIds.push(ids); return read('portfolioDelivery'); },
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => read('procurements') }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectIdentity: () => ({ data: [] }),
  useProjects: (opts?: { enabled?: boolean }) => {
    h.projectListEnabled = opts?.enabled === true;
    return { data: [], isPending: !h.projectListEnabled, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }) }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: (key: string) => key === 'management_views' && h.managementViews }));

import { CompanyDashboard } from './CompanyDashboard';

const renderRole = (role: 'Executive' | 'Admin' | 'Finance') => {
  h.role = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><LocationProbe /><CheckInProbe /><ToastProvider><CompanyDashboard role={role} /></ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
};
const renderExec = () => renderRole('Executive');
const renderAdmin = () => renderRole('Admin');
const renderFinance = () => renderRole('Finance');
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="dashboard-location">{location.pathname}{location.search}</output>;
}
function CheckInProbe() {
  const query = useCheckInRequests();
  return <output data-testid="check-in-probe" data-status={query.status} data-count={query.data?.length ?? -1}>{query.status}</output>;
}
const band = () => screen.getByRole('region', { name: 'Company figures' });
const tile = (label: string) => within(band()).getByText(label, { exact: true }).closest('div[class*="flex-col"]') as HTMLElement;

beforeEach(() => {
  localStorage.removeItem('home-layout');
  h.role = 'Executive';
  h.managementViews = false;
  h.portfolioIds = [];
  h.projectListEnabled = false;
  h.checkInRequests = () => Promise.resolve([]);
  h.reads = { dashboard: ok(dash), pack: ok(pack), invoices: ok([invoice]), salesInvoices: ok([]), payments: ok([]), procurements: ok([]) };
});

it('AC-MV-006 keeps the new portfolio hidden and its project reads disabled until the organisation opts in', () => {
  renderExec();
  expect(screen.queryByTestId('project-portfolio-table')).toBeNull();
  expect(h.projectListEnabled).toBe(false);
  expect(h.portfolioIds).toEqual([[], []]);
});

it('AC-MV-001 shows the cold empty portfolio instead of a skeleton when disabled empty-ID queries are pending', () => {
  h.managementViews = true;
  h.reads.portfolioMilestones = pending;
  h.reads.portfolioDelivery = pending;
  renderExec();
  expect(h.projectListEnabled).toBe(true);
  const portfolio = screen.getByTestId('project-portfolio-table');
  expect(within(portfolio).getByText('No active delivery projects')).toBeInTheDocument();
  expect(within(portfolio).queryByTestId('liststate-loading')).toBeNull();
});

it('AC-2077 finance company-home overdue rows keep the existing list destination as real links', async () => {
  h.reads.salesInvoices = ok([invoice]);
  renderFinance();

  const link = await screen.findByRole('link', { name: 'Open overdue invoice for Client One' });
  expect(link).toHaveAttribute('href', '/finance/receivables?overdue=true');
  await userEvent.click(link);
  expect(screen.getByTestId('dashboard-location')).toHaveTextContent('/finance/receivables?overdue=true');
});

describe('company home loading gates: one read pending', () => {
  it('the management pack still loading holds only Invoiced and Left to bill; Contract on hand, Project health and Owed to us show', () => {
    h.reads.pack = pending;
    renderExec();
    expect(tile('Contract on hand · excl. tax')).toHaveTextContent('$8M');
    expect(within(tile('Invoiced')).getByTestId('kpi-skeleton')).toBeInTheDocument();
    expect(within(screen.getByTestId('project-health')).getByRole('link', { name: /River project/ })).toBeInTheDocument();
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent('$40K');
  });

  it('client invoices still loading hold only Owed to us; the figures band and the supplier side show', () => {
    h.reads.invoices = pending;
    renderExec();
    expect(tile('Contract on hand · excl. tax')).toHaveTextContent('$8M');
    expect(tile('Invoiced')).toHaveTextContent('$1.2M');
    expect(within(screen.getByTestId('owed-to-us')).getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    expect(screen.getByTestId('owed-to-suppliers')).toHaveTextContent('No supplier invoice to pay');
  });

  it('the dashboard read still loading holds Contract on hand and Project health; Invoiced shows', () => {
    h.reads.dashboard = pending;
    renderExec();
    expect(within(tile('Contract on hand · excl. tax')).getByTestId('kpi-skeleton')).toBeInTheDocument();
    expect(tile('Invoiced')).toHaveTextContent('$1.2M');
  });
});

describe('company home loading gates: one read failed', () => {
  it('a failed management pack says so on Invoiced (never blank, never $0); the other figures show', () => {
    h.reads.pack = failed;
    renderExec();
    expect(tile('Invoiced')).toHaveTextContent("Couldn't load");
    expect(tile('Invoiced')).not.toHaveTextContent('$0');
    expect(tile('Contract on hand · excl. tax')).toHaveTextContent('$8M');
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent('$40K');
  });

  it('a failed dashboard read says so on Contract on hand and in Project health; Invoiced and Owed to us show', () => {
    h.reads.dashboard = failed;
    renderExec();
    expect(tile('Contract on hand · excl. tax')).toHaveTextContent("Couldn't load");
    expect(within(screen.getByTestId('project-health')).getByText("Couldn't load projects")).toBeInTheDocument();
    expect(tile('Invoiced')).toHaveTextContent('$1.2M');
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent('$40K');
  });

  it('failed client invoices say so in Owed to us; the figures band and the supplier side show', () => {
    h.reads.invoices = failed;
    renderExec();
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent("Couldn't load invoices");
    expect(tile('Contract on hand · excl. tax')).toHaveTextContent('$8M');
    expect(screen.getByTestId('owed-to-suppliers')).toHaveTextContent('No supplier invoice to pay');
  });
});

describe('company home states keep the filled structure', () => {
  it('a failed dashboard read keeps the margin tile in the figures band (same tiles as loaded)', () => {
    h.reads.dashboard = failed;
    renderExec();
    expect(within(band()).getByText(/margin on billed work/i)).toBeInTheDocument();
    expect(within(band()).getAllByText("Couldn't load")).toHaveLength(2);
  });

  it('the failed tile is one line: its message and Retry sit together', () => {
    h.reads.dashboard = failed;
    renderExec();
    const failedTile = screen.getByTestId('figure-error-contract-on-hand');
    expect(within(failedTile).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(failedTile).toHaveTextContent(/Couldn't load.*Retry/);
  });

  it('Project health loads as rows, not four short lines, so the column keeps its height', () => {
    h.reads.dashboard = pending;
    renderExec();
    const health = screen.getByTestId('project-health');
    expect(health.querySelector('[data-skeleton-shape="rows"]')).not.toBeNull();
  });
});

describe('AC-PCI-E2E / AC-WCI-060 phone check-ins waiting entry on CompanyDashboard', () => {
  const pendingCheckIn = {
    id: 'req-1',
    work_order_id: 'wo-1',
    work_order_title: 'Slab',
    worker_name: 'Worker 1',
    crew_id: null,
    crew_name: null,
    work_date: '2026-10-27',
    hours: 8,
    outcome: 'outside',
    distance_m: 1112,
    accuracy_m: 5,
    checked_in_at: '2026-10-27T08:00:00Z',
    area_lat: -6.2,
    area_lng: 106.8,
    area_radius_m: 150,
  };

  it('eligible role Admin renders positive count linking to /crews and navigates to the exact existing destination', async () => {
    h.checkInRequests = () => Promise.resolve([pendingCheckIn]);
    renderAdmin();

    const link = await screen.findByRole('link', { name: /1 check-in waiting for your decision/i });
    expect(link).toHaveAttribute('href', '/crews');
    await userEvent.click(link);
    expect(screen.getByTestId('dashboard-location')).toHaveTextContent('/crews');
  });

  it('eligible role Executive renders plural count when multiple requests wait', async () => {
    h.checkInRequests = () => Promise.resolve([pendingCheckIn, { ...pendingCheckIn, id: 'req-2' }]);
    renderExec();

    const link = await screen.findByRole('link', { name: /2 check-ins waiting for your decision/i });
    expect(link).toHaveAttribute('href', '/crews');
  });

  it('mounts check-ins waiting row across both overview and focused layouts for eligible role', async () => {
    h.checkInRequests = () => Promise.resolve([pendingCheckIn]);

    localStorage.setItem('home-layout', 'focused');
    const { unmount } = renderAdmin();
    expect(await screen.findByRole('link', { name: /check-in.*waiting for your decision/i })).toBeInTheDocument();
    unmount();

    localStorage.setItem('home-layout', 'overview');
    renderAdmin();
    expect(await screen.findByRole('link', { name: /check-in.*waiting for your decision/i })).toBeInTheDocument();
  });

  it('zero count safely omits check-ins waiting row and displays no dummy count', async () => {
    h.checkInRequests = () => Promise.resolve([]);
    renderAdmin();

    await waitFor(() => expect(screen.getByTestId('check-in-probe')).toHaveTextContent('success'));
    expect(screen.getByTestId('check-in-probe')).toHaveAttribute('data-count', '0');

    expect(screen.queryByText(/check-in.*waiting for your decision/i)).not.toBeInTheDocument();
  });

  it('unknown / pending check-in read safely omits the row without breaking dashboard', () => {
    h.checkInRequests = () => new Promise(() => {});
    renderAdmin();

    expect(screen.getByTestId('check-in-probe')).toHaveTextContent('pending');
    expect(screen.queryByText(/check-in.*waiting for your decision/i)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Company figures' })).toBeInTheDocument();
  });

  it('error on check-in read is safely handled without displaying dummy counts or throwing', async () => {
    h.checkInRequests = () => Promise.reject(new Error('RPC error'));
    renderAdmin();

    await waitFor(() => expect(screen.getByTestId('check-in-probe')).toHaveTextContent('error'));

    expect(screen.queryByText(/check-in.*waiting for your decision/i)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Company figures' })).toBeInTheDocument();
  });

  it('ineligible role Finance never renders check-ins waiting row even when pending requests exist per real hook contract', async () => {
    h.checkInRequests = () => Promise.resolve([pendingCheckIn]);
    renderFinance();

    await waitFor(() => expect(screen.getByTestId('check-in-probe')).toHaveTextContent('success'));
    expect(screen.getByTestId('check-in-probe')).toHaveAttribute('data-count', '1');

    expect(screen.queryByText(/check-in.*waiting for your decision/i)).not.toBeInTheDocument();
  });
});
