/**
 * AC-IXD-DASH-W5-C2A — Dashboard KPI drill-through (Wave 5, Cluster 2, PR-A)
 *
 * Tests that:
 * 1. Wired KPI tiles render as <Link> elements pointing to the right URL
 * 2. Plain tiles are NOT links
 * 3. Each dashboard drills correctly per the §3 disposition tables
 * 4. The shared at-risk threshold constant is exported from the right place
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

// ── Shared mocks ────────────────────────────────────────────────────────────

const dash = {
  active_projects: 4,
  active_delivery_projects: 4,
  risk_unchecked_projects: 0,
  total_contract_value: 8_000_000, currency: 'USD',
  on_hand_margin: 0.25,
  on_hand_value: 6_000_000,
  on_hand_contract_remaining: 4_000_000,
  on_hand_realized_margin: 1_000_000,
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 1_000_000, unknown_projects: 0 }],
  pipeline_weighted_value: 800_000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 2_000_000,
  projects_at_risk: 1,
  projects_by_status: [],
  procurements_by_status: [{ status: 'Paid', count: 2 }],
  top_projects: [],
  attention_projects: [
    { id: 'p1', name: 'Alpha', client_name: 'Acme', contract_value: 5_000_000, currency: 'USD', budget: 4_000_000, spent: 3_000_000, status: 'Ongoing Project', attention_signals: 1, overdue_items: 2, overdue_tasks: 2, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: null },
    { id: 'p2', name: 'Beta', client_name: 'Beta Co', contract_value: 3_000_000, currency: 'USD', budget: 2_000_000, spent: 1_000_000, status: 'Ongoing Project', attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: null },
  ],
};

const procurements = [
  { id: 'pr1', status: 'Vendor Invoiced', total_value: 250_000, currency: 'USD', requested_by_id: 'u1', procurement_invoices: [{ amount: 250_000 }], payments: [] },
  { id: 'pr2', status: 'Paid', total_value: 999_999, currency: 'USD', requested_by_id: 'u1' },
];

// Keep the company-hub data sources deterministic so these checks bind KPI destinations and names.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/reports/BoardPackAction', () => ({ BoardPackAction: () => null }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-06-03', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useOverdueInvoiceFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  usePaidPaymentFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnySalesInvoice: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: { totals: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: () => ({ data: { rows: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: mine ?? [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, isPending: false, isError: false, refetch: vi.fn() }),
}));
// task FIX-2 (Discover CRITICAL 2): FinanceDashboard now mounts AccountingSnapshotsSection.
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: () => ({ customerLinks: new Map() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

// ── Exec dashboard ───────────────────────────────────────────────────────────

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));

import { CompanyDashboard } from '@/src/components/dashboard/hub/company/CompanyDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
import { KPITile } from '@/src/components/ui/KPITile';

const renderExec = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ToastProvider>
          <CompanyDashboard role="Executive" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const companyFigureTile = (label: string) => {
  const section = screen.getByRole('region', { name: 'Company figures' });
  const labelElement = within(section).getByText(label, { exact: true });
  // The tile root is the nearest ancestor holding the tile's link.
  let tile: HTMLElement | null = labelElement;
  while (tile && !tile.querySelector('a')) tile = tile.parentElement;
  expect(tile).not.toBeNull();
  return tile as HTMLElement;
};

describe('AC-IXD-DASH-W5-C2A — Executive dashboard drills', () => {
  // #1461: each href opens exactly the record set its figure sums/counts.
  // - Contract on hand / Margin on billed work sum the ON-HAND projects (Won-Pending-KoM,
  //   Ongoing, On Hold, Close Out) → the `on-hand` list filter, not the narrower Ongoing tab.
  // - Owed by clients is every open client invoice → Receivables.
  // - Supplier payables count Vendor Invoiced procurements → the exact status filter.
  // - Pipeline is the open-stage set → /sales (the Sales card's link).
  const executiveDrills = [
    ['Contract on hand', '/projects?filter=on-hand'],
    ['Owed by clients', '/finance/receivables'],
    ['Owed to suppliers', '/procurement?status=Vendor+Invoiced'],
  ] as const;

  it('AC-IXD-DASH-W5-C2A-EXEC-1: each company figure with a destination links to its owning page', () => {
    renderExec();
    for (const [label, href] of executiveDrills) {
      const tile = companyFigureTile(label);
      expect(within(tile).getByRole('link')).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('link', { name: 'Open sales' })).toHaveAttribute('href', '/sales');
  });

  it('AC-IXD-DASH-W5-C2A-EXEC-2: a KPI without a destination does not render a drill link', () => {
    render(<KPITile testId="kpi-without-destination" icon="grid" tone="blue" label="Unlinked figure" value="—" />);
    expect(within(screen.getByTestId('kpi-without-destination')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('AC-UX-017: contract on hand shows its amount with currency; the left-after-spending line is gone from the tile', () => {
    renderExec();
    const contractTile = companyFigureTile('Contract on hand');
    expect(contractTile).toHaveTextContent('$6M');
    expect(contractTile).not.toHaveTextContent(/Left after spending/);
    expect(within(contractTile).getByRole('link')).toHaveAttribute('href', '/projects?filter=on-hand');
  });

  it('#1461: each period figure drills with its own window to the list holding its counted records', async () => {
    renderExec();
    // The harness org day is 2026-06-03, so the default ytd period is 2026-01..2026-06.
    // - Invoiced sums issued invoices dated in the window → receivables invoices in that window.
    // - Collected sums Paid receipts dated in the window → the payments view, Paid, same window (billing analysis).
    expect(within(screen.getByRole('region', { name: 'Company figures' })).getByRole('link', { name: /^Invoiced/ }))
      .toHaveAttribute('href', '/finance/receivables?from=2026-01&to=2026-06');
    await userEvent.click(screen.getByText('Analysis'));
    expect(await screen.findByRole('link', { name: /^Collected/ }))
      .toHaveAttribute('href', '/finance/receivables?view=payments&status=Paid&from=2026-01&to=2026-06');
  });

  it('AC-IXD-DASH-W5-C2A-a11y: each company drill link has an accessible name that is its label', () => {
    renderExec();
    for (const [label] of executiveDrills) {
      const link = within(companyFigureTile(label)).getByRole('link');
      expect(link.getAttribute('aria-label')).toBe(label);
    }
  });
});

// ── Finance dashboard ────────────────────────────────────────────────────────

import { FinanceDashboard } from '@/src/components/dashboard/FinanceDashboard';

const renderFinance = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FinanceDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('AC-IXD-DASH-W5-C2A — Finance dashboard KPI drills', () => {
  it('AC-IXD-DASH-W5-C2A-FIN-1: "Contracted revenue" drills to exactly its counted set (Ongoing Project only, #1461)', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-revenue');
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/projects?filter=ongoing-project');
  });

  it('AC-IXD-DASH-W5-C2A-FIN-2: "Recorded spending" drills to exactly its counted set (on-hand projects, #1461)', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-spend');
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/projects?filter=on-hand');
  });

  it('AC-IXD-DASH-W5-C2A-FIN-3: "Outstanding invoices" tile drills to /procurement?status=Vendor+Invoiced', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-outstanding');
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/procurement?status=Vendor+Invoiced');
  });

  it('AC-IXD-DASH-W5-C2A-FIN-3: "Outstanding invoices" tile has a descriptive linkLabel', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-outstanding');
    const label = within(tile).getByRole('link').getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label!.toLowerCase()).toContain('supplier');
  });

  it('AC-UX-017: the margin-to-date tile is not a link that implies cash or profit finality', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-margin');
    expect(tile.tagName).toBe('DIV');
    expect(tile).not.toHaveAttribute('href');
  });
});

// ── PM dashboard ─────────────────────────────────────────────────────────────

const mine = [
  { id: 'p1', name: 'My Project A', contract_value: 4_000_000, currency: 'USD', budget: 3_000_000, spent: 1_000_000, realized_margin: 500_000, realized_margin_pct: null, contract_remaining: 3_000_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client_name: 'Acme', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
  { id: 'p2', name: 'My Project B', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 980_000, realized_margin: 120_000, realized_margin_pct: null, contract_remaining: 1_020_000, status: 'Won, Pending KoM', project_manager_id: 'pm-1', client_name: 'Beta', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
];


vi.mock('@/src/hooks/useProjects', () => ({
  useProjectIdentity: () => ({ data: [] }),
  useProjects: () => ({ data: [] }),
  useProject: () => ({ data: { pmo_project_number: 'PRJ-26-0001' }, isPending: false, isError: false }),
  // #1890: the PM project area reads numbers for the visible cards in ONE batched request.
  useProjectNumbers: () => ({ data: { p1: 'PRJ-26-0001', p2: 'PRJ-26-0002' }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({
  useProjectStatusLabel: () => (status: string) => status,
  useProcurementStatusLabel: () => (status: string) => status,
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: {}, isPending: false, isError: false }),
}));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/dashboard/restructure/useNeedsYou')>();
  return {
    ...actual,
    useNeedsYou: () => ({ items: [], areaItems: [], pmOverdueTasksByProject: {}, isPending: false, isError: false, refetch: vi.fn() }),
  };
});

import { PMDashboard } from '@/src/components/dashboard/PMDashboard';

const renderPM = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><PMDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );

describe('AC-IXD-DASH-W5-C2A — PM dashboard drills', () => {
  // #1461: the PM figures count MY DELIVERY projects (get_pm_dashboard_projects ∩ delivery
  // statuses), so every drill carries the delivery filter scoped to my PM id — never the
  // all-statuses "My Projects" tab nor the org-wide at-risk filter.
  it('AC-IXD-DASH-W5-C2A-PM-1: "All N projects" drills to my delivery projects (#1461)', () => {
    renderPM();
    expect(within(screen.getByTestId('pm-projects')).getByRole('link', { name: 'All 2 projects' })).toHaveAttribute('href', '/projects?filter=delivery&pm=u1');
  });

  it('AC-IXD-DASH-W5-C2A-PM-2: "My contract value" drills to my delivery projects (#1461)', () => {
    renderPM();
    const tile = screen.getByTestId('kpi-my-contract-value');
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/projects?filter=delivery&pm=u1');
  });

  it('AC-IXD-DASH-W5-C2A-PM-3: each project row opens its own project', () => {
    renderPM();
    const list = screen.getByTestId('pm-projects');
    expect(within(list).getByRole('link', { name: /My Project A/ })).toHaveAttribute('href', '/projects/p1');
    expect(within(list).getByRole('link', { name: /My Project B/ })).toHaveAttribute('href', '/projects/p2');
  });
});

// ── Engineer dashboard ────────────────────────────────────────────────────────

const sheets = [
  {
    id: 's1', status: 'Draft', week_start_date: '2026-06-01', user_id: 'eng-1', org_id: 'o1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [
      { id: 'e1', hours: 8, entry_date: '2026-06-01', project_id: 'p1', timesheet_id: 's1', org_id: 'o1', notes: null, project: { name: 'A', code: null } },
    ],
  },
];

vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => ({ data: sheets, isPending: false, isError: false, refetch: vi.fn() }),
}));

import { EngineerDashboard } from '@/src/components/dashboard/EngineerDashboard';
import { pinHomeLayout } from '@/test/homeLayout';

pinHomeLayout('focused');

const renderEngineer = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <EngineerDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('AC-IXD-DASH-W5-C2A — Engineer dashboard drills', () => {
  it('AC-IXD-DASH-W5-C2A-ENG-1: the timesheet card action goes to /timesheets', () => {
    renderEngineer();
    const card = screen.getByTestId('engineer-timesheet');
    expect(within(card).getByRole('link', { name: 'Submit week' })).toHaveAttribute('href', '/timesheets');
  });

  it('AC-IXD-DASH-W5-C2A-ENG-2: the tasks card links to all tasks', () => {
    renderEngineer();
    expect(within(screen.getByTestId('engineer-tasks')).getByRole('link', { name: 'All tasks' })).toHaveAttribute('href', '/my-tasks');
  });
});
