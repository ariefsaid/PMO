import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import { BahasaProvider } from '@/test/bahasa';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { PMDashboard } from './PMDashboard';

const state = vi.hoisted(() => ({
  projects: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  delivery: { data: {} as Record<string, number>, isPending: false, isError: false, refetch: vi.fn() },
  timesheets: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  procurements: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  needs: {
    items: [] as unknown[],
    pmOverdueTasksByProject: {} as Record<string, number>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectDetails: {} as Record<string, unknown>,
  /** Per-project finances the project Overview reads (its margin gate); a project absent here has none loaded. */
  finances: {} as Record<string, unknown>,
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  usePMDashboardProjects: () => state.projects,
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => state.delivery,
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => state.timesheets,
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => state.procurements,
}));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => state.needs,
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: (id: string) => state.projectDetails[id] ?? { data: null, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: (id: string) => ({ data: state.finances[id], isPending: false, isError: false }),
}));
// useProjectStatusLabel stays REAL (a pure i18n lookup): English defaults equal the enum, and the
// Bahasa port below asserts the translated status a PM actually reads.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const makeProject = (overrides: Partial<PMDashboardProject> & Pick<PMDashboardProject, 'id' | 'name' | 'status'>): PMDashboardProject => {
  const { id, name, status, ...rest } = overrides;
  return {
    id,
    name,
    status,
    short_name: null,
    client_name: 'Acme Works',
    contract_value: 100_000,
    currency: 'USD',
    budget: 100_000,
    spent: 95_000,
    actual_currency: 'USD',
    actual_complete: true,
    budget_currency: 'USD',
    actual_coverage_count: 1,
    actual_coverage_total: 1,
    realized_margin: 12_500,
    realized_margin_pct: 0.125,
    contract_remaining: 5_000,
    ...rest,
  };
};

/**
 * The finances payload the project Overview derives its margin from. A project whose margin is known
 * has every category mapped (margin = billed revenue less spending); otherwise a category is unmapped.
 */
const financesFor = (project: PMDashboardProject, over: { mapped?: boolean } = {}) => ({
  project_id: project.id, contract_invoiced: null, remaining_to_invoice: null, budget: null,
  invoices: [{
    currency: project.currency, invoice_count: 1, invoiced: null, settled: null, outstanding: null, missing_amount: 0,
    missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: `${(project.realized_margin ?? 0) + (project.spent ?? 0)}.00`, missing_work: 0,
  }],
  actuals: {
    currency: project.currency, as_of: null, total: `${project.spent ?? 0}.00`, excludes_restricted_rows: false,
    categories: [{ category: 'Materials', mapped: over.mapped ?? project.realized_margin != null, amount: `${project.spent ?? 0}.00` }],
  },
});
const loadFinances = (list: PMDashboardProject[]) => Object.fromEntries(list.map((project) => [project.id, financesFor(project)]));

const projects = [
  makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project' }),
  makeProject({
    id: 'p2', name: 'Project Two', status: 'On Hold', contract_value: 250_000,
    budget: 200_000, spent: 50_000, contract_remaining: 200_000, realized_margin: 40_000,
    realized_margin_pct: 0.2,
  }),
  makeProject({
    id: 'p3', name: 'Project Three', status: 'Close Out', contract_value: 150_000,
    budget: 100_000, spent: 10_000, contract_remaining: 140_000, realized_margin: 30_000,
    realized_margin_pct: 0.15,
  }),
  makeProject({ id: 'lost', name: 'Lost Project', status: 'Loss Tender' }),
  makeProject({ id: 'lead', name: 'Pipeline Project', status: 'Leads' }),
];

const approvalItems = [
  { id: 'approvals', count: 3, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' },
  { id: 'team-timesheets', count: 2, label: 'team timesheets to approve', href: '/approvals?scope=timesheets', tone: 'warn' },
];

let queryClient: QueryClient;
const renderDashboard = (locale: 'en' | 'id' = 'en') => {
  setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BahasaProvider locale={locale}>
        <MemoryRouter><PMDashboard /></MemoryRouter>
      </BahasaProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  cleanup();
  state.projects.data = projects;
  state.projects.isPending = false;
  state.projects.isError = false;
  state.delivery.data = { p1: 45, p2: 70, p3: 20 };
  state.delivery.isPending = false;
  state.delivery.isError = false;
  state.timesheets.data = [{ id: 'ts1', entries: [{ hours: 2.5 }, { hours: 3.25 }] }];
  state.timesheets.isPending = false;
  state.timesheets.isError = false;
  state.procurements.data = [];
  state.procurements.isPending = false;
  state.procurements.isError = false;
  state.needs.items = approvalItems;
  state.needs.pmOverdueTasksByProject = { p1: 2 };
  state.needs.isPending = false;
  state.needs.isError = false;
  state.projectDetails = Object.fromEntries(projects.map((project, index) => [project.id, {
    data: { pmo_project_number: `PRJ-26-${String(index + 1).padStart(4, '0')}` },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }]));
  state.finances = loadFinances(projects);
  for (const query of [state.projects, state.delivery, state.timesheets, state.procurements, state.needs]) {
    query.refetch.mockReset();
  }
});

describe('Project Manager area hub', () => {
  it('shows five linked KPIs, approvals, and project figures with working destinations', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { level: 1, name: 'My dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Your 3 projects and what needs you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();

    const expectedKpis = [
      ['kpi-my-projects', 'My projects', '/projects?filter=My+Projects'],
      ['kpi-my-contract-value', 'My contract value', '/projects?filter=My+Projects'],
      ['kpi-at-risk', 'At risk', '/projects?filter=at-risk'],
      ['kpi-margin-to-date', 'Margin to date', '/projects?filter=My+Projects'],
      ['kpi-team-hours', 'Team hours to approve', '/approvals?scope=timesheets'],
    ];

    for (const [testId, label, href] of expectedKpis) {
      const tile = screen.getByTestId(testId);
      expect(tile).toHaveTextContent(label);
      expect(within(tile).getByRole('link')).toHaveAttribute('href', href);
      expect(within(tile).getByRole('button', { name: `Help: ${label}` })).toBeInTheDocument();
    }

    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$500K');
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$345K left after spending');
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-margin-to-date')).toHaveTextContent('$82.5K');
    expect(screen.getByTestId('kpi-team-hours')).toHaveTextContent('5.75 h');

    expect(screen.getByRole('link', { name: /3 approvals waiting for you/i })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('link', { name: /2 team timesheets to approve/i })).toHaveAttribute('href', '/approvals?scope=timesheets');
    expect(screen.getByRole('link', { name: 'Project One' })).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByText('PRJ-26-0001')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Works')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Delivery 45%' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Project One: 95% of contract spent' })).toBeInTheDocument();
  });

  it('shows project-specific risk, overdue task, and procurement links without work actions', () => {
    state.procurements.data = [{
      id: 'pr1', project_id: 'p1', requested_by_id: 'another-user', status: 'Requested', approvalRoute: null, title: 'Inverter spares',
    }];
    renderDashboard();

    const area = screen.getByRole('heading', { name: 'Project One' }).closest('.panel-card');
    expect(area).not.toBeNull();
    expect(within(area as HTMLElement).getByRole('link', { name: /budget is at least 90% spent/i })).toHaveAttribute('href', '/projects/p1');
    expect(within(area as HTMLElement).getByRole('link', { name: /2 overdue tasks/i })).toHaveAttribute('href', '/projects/p1/tasks');
    expect(within(area as HTMLElement).getByRole('link', { name: /procurement waiting for your approval/i })).toHaveAttribute('href', '/procurement?open=pr1');
    expect(within(area as HTMLElement).getByText('Inverter spares')).toBeInTheDocument();
    expect(within(area as HTMLElement).queryByText(/supplier unavailable/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Nothing needs you here.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^(approve|submit|create)/i })).not.toBeInTheDocument();
  });

  it('keeps only delivery projects, orders attention first, caps panels at six, and links to all projects', () => {
    state.projects.data = [
      ...projects.slice(0, 3),
      makeProject({ id: 'p4', name: 'Project Four', status: 'Ongoing Project', spent: 20_000 }),
      makeProject({ id: 'p5', name: 'Project Five', status: 'Ongoing Project', spent: 20_000 }),
      makeProject({ id: 'p6', name: 'Project Six', status: 'Ongoing Project', spent: 20_000 }),
      makeProject({ id: 'p7', name: 'Project Seven', status: 'Ongoing Project', spent: 20_000 }),
      ...projects.slice(3),
    ];
    state.needs.pmOverdueTasksByProject = { p6: 5 };
    renderDashboard();

    const projectHeadings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(projectHeadings.slice(0, 2)).toEqual(['Project One', 'Project Six']);
    expect(projectHeadings).toHaveLength(6);
    expect(screen.queryByRole('heading', { name: 'Project Seven' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lost Project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pipeline Project' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all 7 projects' })).toHaveAttribute('href', '/projects?filter=My+Projects');
  });

  it('keeps currencies separate and shows an explained dash when an aggregate is incomplete', () => {
    state.projects.data = [
      projects[0],
      makeProject({
        id: 'eur', name: 'Euro Project', status: 'Ongoing Project', currency: 'EUR',
        contract_value: 80_000, budget_currency: 'EUR', actual_currency: 'EUR',
      }),
    ];
    renderDashboard();

    const contract = screen.getByTestId('kpi-my-contract-value');
    expect(contract).toHaveTextContent('$100,000');
    expect(contract).toHaveTextContent('€80,000');
    expect(contract).not.toHaveTextContent(/USD\s+\$|IDR\s+IDR/);

    cleanup();
    state.projects.data = [
      projects[0],
      makeProject({ id: 'unknown', name: 'Unknown Project', status: 'Ongoing Project', contract_value: null, realized_margin: null }),
    ];
    renderDashboard();

    const unknownContract = screen.getByTestId('kpi-my-contract-value');
    expect(within(unknownContract).queryByText('$100,000')).not.toBeInTheDocument();
    const contractReasons = within(unknownContract).getAllByRole('status');
    expect(contractReasons).toHaveLength(1);
    expect(contractReasons[0]).toHaveTextContent(/one or more project contract values are unavailable/i);
    // C4: an unknown margin is left out of the band, and the reason is said once under it.
    expect(screen.queryByTestId('kpi-margin-to-date')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Some projects have incomplete spending/)).toHaveLength(1);
  });

  it('states Budget not set once in project metadata without an unknown-risk attention row', () => {
    state.projects.data = [makeProject({
      id: 'no-budget', name: 'No Budget Project', status: 'Ongoing Project',
      budget: null, budget_currency: null, spent: null, actual_complete: false,
    })];
    renderDashboard();

    const area = screen.getByRole('heading', { name: 'No Budget Project' }).closest('.panel-card');
    expect(area).not.toBeNull();
    expect(within(area as HTMLElement).getAllByText('Budget not set')).toHaveLength(1);
    expect(within(area as HTMLElement).queryByText(/budget risk can.t be checked yet/i)).not.toBeInTheDocument();
  });

  it('shows loading, retryable error, and the no-project state', () => {
    state.projects.data = undefined;
    state.projects.isPending = true;
    renderDashboard();
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);

    cleanup();
    state.projects.isPending = false;
    state.projects.isError = true;
    renderDashboard();
    expect(screen.getByText("Couldn't load your projects and attention items")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.projects.refetch).toHaveBeenCalledOnce();

    cleanup();
    state.projects.isError = false;
    state.projects.data = [];
    renderDashboard();
    expect(screen.getByText('No delivery projects assigned to you yet')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('0');
    expect(screen.queryByRole('link', { name: /View all/ })).not.toBeInTheDocument();
  });

  it('refreshes the dashboard read queries from the outline control', () => {
    renderDashboard();

    vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(state.projects.refetch).toHaveBeenCalledOnce();
    expect(state.delivery.refetch).toHaveBeenCalledOnce();
    expect(state.timesheets.refetch).toHaveBeenCalledOnce();
    expect(state.procurements.refetch).toHaveBeenCalledOnce();
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('localizes the page title, project empty state, and KPI labels in Indonesian', () => {
    state.projects.data = [];
    renderDashboard('id');

    expect(screen.getByRole('heading', { level: 1, name: 'Dasbor saya' })).toBeInTheDocument();
    expect(screen.getByText('Belum ada proyek pelaksanaan yang ditugaskan kepada Anda')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('Proyek saya');
    expect(screen.getByTestId('kpi-team-hours')).toHaveTextContent('Jam tim yang perlu disetujui');
  });
});

// ---------------------------------------------------------------------------
// Ported from the pre-restructure PMDashboard.test.tsx (baseline fa511c382). Same fixture values and
// oracles — delivery scope, money totals, risk, status, links, states, Bahasa — against the
// recomposed per-project hub.
// ---------------------------------------------------------------------------

const baseline = [
  makeProject({
    id: 'b1', name: 'My Project A', status: 'Ongoing Project', client_name: 'Acme',
    contract_value: 4_000_000, budget: 3_000_000, spent: 1_000_000,
    realized_margin: 250_000, realized_margin_pct: 0.25, contract_remaining: 3_000_000,
  }),
  makeProject({
    id: 'b2', name: 'My Project B', status: 'Won, Pending KoM', client_name: 'Beta',
    contract_value: 2_000_000, budget: 1_000_000, spent: 980_000,
    realized_margin: null, realized_margin_pct: null, contract_remaining: 1_020_000,
  }),
  makeProject({
    id: 'b3', name: 'My Project C', status: 'Loss Tender',
    contract_value: 1_000_000, budget: 500_000, spent: 100_000, contract_remaining: 900_000,
  }),
  makeProject({
    id: 'b4', name: 'My Project D', status: 'On Hold',
    contract_value: 1_000_000, budget: 500_000, spent: 100_000, contract_remaining: 900_000,
  }),
  makeProject({
    id: 'b5', name: 'My Project E', status: 'Leads',
    contract_value: 1_000_000, budget: 500_000, spent: 100_000, contract_remaining: 900_000,
  }),
  makeProject({
    id: 'b6', name: 'My Project F', status: 'Close Out',
    contract_value: 3_600_000, budget: 2_000_000, spent: 500_000, contract_remaining: 1_500_000,
  }),
];
const baselineDelivery = baseline.filter((project) => !['Loss Tender', 'Leads'].includes(project.status));

const areaFor = (name: string) => {
  const area = screen.getByRole('heading', { name }).closest('.panel-card');
  expect(area).not.toBeNull();
  return area as HTMLElement;
};

describe('PMDashboard — ported baseline cases (delivery scope, money, risk, status)', () => {
  beforeEach(() => {
    state.projects.data = baseline;
    state.finances = loadFinances(baseline);
    state.delivery.data = {};
    state.needs.items = [];
    state.needs.pmOverdueTasksByProject = {};
  });

  it('counts on-hand and internal delivery projects, including Close Out', () => {
    renderDashboard();
    // Ongoing + Won, Pending KoM + On Hold + Close Out; Loss Tender and Leads are not delivery projects.
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('4');
  });

  it('sums my delivery contract value including Close Out, not the whole org', () => {
    renderDashboard();
    // 4M + 2M + 1M + 3.6M — short on the tile, the exact sum rides in the figure title.
    const tile = screen.getByTestId('kpi-my-contract-value');
    expect(tile).toHaveTextContent('$10.6M');
    expect(tile.querySelector('[title="$10,600,000"]')).not.toBeNull();
  });

  it('renders exactly one at-risk tile, counting only active delivery projects (AC-AT-RISK-INACTIVE)', () => {
    state.projects.data = [
      makeProject({ id: 'p-active', name: 'Active At Risk', status: 'Ongoing Project', budget: 1_000_000, spent: 950_000, contract_value: 2_000_000 }),
      makeProject({ id: 'p-inactive', name: 'Inactive At Risk', status: 'Loss Tender', budget: 1_000_000, spent: 950_000, contract_value: 2_000_000 }),
    ];
    renderDashboard();
    const tiles = screen.getAllByTestId('kpi-at-risk');
    expect(tiles).toHaveLength(1);
    // Only the active project at 95% counts — 1, not 2.
    expect(within(tiles[0]).getByText('1')).toBeInTheDocument();
    expect(tiles[0]).not.toHaveTextContent('2');
    expect(within(tiles[0]).getByRole('link')).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(within(tiles[0]).getByRole('button', { name: /Help: At risk/i })).toBeInTheDocument();
    expect(screen.queryByText(/Procurement approvals — coming soon/i)).not.toBeInTheDocument();
  });

  it('AC-RD-RISK-001: says risk cannot be checked when active projects have no usable budgets', () => {
    state.projects.data = [makeProject({
      id: 'p-unknown', name: 'Unbudgeted project', status: 'Ongoing Project', contract_value: null,
      budget: null, spent: null, realized_margin: null, contract_remaining: null,
      actual_complete: false, actual_currency: null, budget_currency: null,
    })];
    renderDashboard();
    const tile = screen.getByTestId('kpi-at-risk');
    // Never a false 0: the figure carries the reason risk is unknown.
    expect(within(tile).queryByText('0')).not.toBeInTheDocument();
    expect(within(tile).getAllByRole('status')).toHaveLength(1);
    expect(within(tile).getByRole('status')).toHaveTextContent(/budget risk is unknown/i);
    expect(screen.queryByText(/all on track/i)).not.toBeInTheDocument();
  });

  it('renders a status per delivery project, including Close Out; pre-win statuses are not listed', () => {
    renderDashboard();
    expect(screen.getByText('Won, Pending KoM')).toBeInTheDocument();
    expect(screen.getByText('On Hold')).toBeInTheDocument();
    expect(screen.getByText('Close Out')).toBeInTheDocument();
    expect(screen.queryByText('Loss Tender')).toBeNull();
    expect(screen.queryByText('Leads')).toBeNull();
  });

  it('UIP-011 / AC-1238-002: every delivery project name is an accessible, correctly routed, titled link', () => {
    renderDashboard();
    for (const project of baselineDelivery) {
      const link = within(areaFor(project.name)).getByRole('link', { name: project.name });
      expect(link).toHaveAttribute('href', `/projects/${project.id}`);
      expect(link).toHaveAttribute('title', project.name);
      expect(link.className).toContain('focus-visible:outline');
    }
    for (const name of ['My Project C', 'My Project E']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('AC-UX-015 / AC-1238-003: names the trailing metric and shows billed-work margin, not contract remainder', () => {
    renderDashboard();
    const projectA = areaFor('My Project A');
    // Labelled visibly and with its own help; the value is the billed-work margin (250K), not the
    // 3M contract remainder and not a percentage.
    expect(within(projectA).getByText('Margin to date')).toBeInTheDocument();
    expect(within(projectA).getByRole('button', { name: 'Help: margin to date' })).toBeInTheDocument();
    expect(within(projectA).getByText('$250K')).toBeInTheDocument();
    expect(within(projectA).queryByText('$3M')).not.toBeInTheDocument();

    // C4: a delivery project without a billed-work margin has no margin figure (and no dash) — never a fabricated percentage.
    const projectB = areaFor('My Project B');
    expect(projectB.textContent).not.toMatch(/\d+\.\d+%/);
    expect(within(projectB).queryByText('Margin to date')).not.toBeInTheDocument();
    expect(within(projectB).queryByText('—')).not.toBeInTheDocument();
  });
});

describe('PMDashboard — ported states (AC-W3-G2)', () => {
  it('AC-W3-G2: isPending → the project area shows loading, not the empty state', () => {
    state.projects.data = undefined;
    state.projects.isPending = true;
    renderDashboard();
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    expect(screen.queryByText(/No delivery projects assigned to you yet/i)).toBeNull();
  });

  it('AC-W3-G2: isError → the project area shows error + retry, not the empty state', () => {
    state.projects.data = undefined;
    state.projects.isError = true;
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.projects.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText(/No delivery projects assigned to you yet/i)).toBeNull();
  });

  it('AC-W3-G2: populated → the project list shows, with no loading or error state', () => {
    state.projects.data = baseline;
    renderDashboard();
    expect(screen.getByRole('link', { name: 'My Project A' })).toBeInTheDocument();
    expect(screen.queryByTestId('liststate-loading')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });

  it('shows a delivery-scoped empty state when assignments are only pre-win projects', () => {
    state.projects.data = [baseline[4]];
    renderDashboard();
    expect(screen.getByText(/No delivery projects assigned to you yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('0');
  });
});

describe('PMDashboard — ported Bahasa (AC-UXA-001)', () => {
  it('AC-UXA-001: localizes PM copy and project statuses without changing values or destinations', () => {
    state.projects.data = baseline;
    state.needs.items = [];
    renderDashboard('id');
    expect(screen.getByRole('heading', { level: 1, name: 'Dasbor saya' })).toBeInTheDocument();
    const myProjects = screen.getByTestId('kpi-my-projects');
    expect(myProjects).toHaveTextContent('Proyek saya');
    fireEvent.focus(within(myProjects).getByRole('button', { name: /Proyek saya/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Proyek pelaksanaan yang ditugaskan kepada Anda sebagai manajer proyek.');
    const openMine = screen.getAllByRole('link', { name: 'Buka proyek saya' });
    expect(openMine.length).toBeGreaterThan(0);
    for (const link of openMine) expect(link).toHaveAttribute('href', '/projects?filter=My+Projects');
    // The status is translated for the reader; the stored enum is unchanged.
    expect(screen.getByText('Menang — menunggu rapat awal')).toBeInTheDocument();
    expect(baseline.find((project) => project.id === 'b2')?.status).toBe('Won, Pending KoM');
    // Money follows the Indonesian number locale: short on the tile, exact in the title.
    const contract = screen.getByTestId('kpi-my-contract-value');
    expect(contract).toHaveTextContent('US$10,6 jt');
    expect(contract.querySelector('[title="US$10.600.000"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Buka proyek berisiko' })).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(screen.getByRole('link', { name: 'My Project B' })).toHaveAttribute('href', '/projects/b2');

    cleanup();
    state.projects.data = undefined;
    state.projects.isPending = true;
    renderDashboard('id');
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);

    cleanup();
    state.projects.isPending = false;
    state.projects.isError = true;
    renderDashboard('id');
    expect(screen.getByText('Tidak dapat memuat proyek dan hal yang perlu ditangani')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Integration rulings re-check (2026-10-28): L12(e)/(h), C4, O4.
// ---------------------------------------------------------------------------
describe('PMDashboard — rulings re-check', () => {
  const meridian = makeProject({
    id: 'mer', name: 'Meridian', status: 'Ongoing Project', contract_value: 5_300_000, spent: 1_800_000,
    realized_margin: 2_500_000, budget: 4_500_000,
  });

  it('QI-5 shows the partial at-risk count in the PM Needs you strip', () => {
    state.projects.data = [meridian];
    state.needs.items = [{
      id: 'projects-over-budget', count: 1, countLabel: 'At least 1',
      label: 'project over 90% of budget', href: '/projects?filter=My+Projects', tone: 'warn',
    }];
    renderDashboard();
    expect(screen.getByRole('link', { name: /At least 1 project over 90% of budget/i })).toHaveAttribute('href', '/projects?filter=My+Projects');
  });

  it('SP-8 the Margin to date tile and project card use the same realized-margin basis', () => {
    state.projects.data = [meridian];
    // Overview finance detail is deliberately different; both dashboard surfaces use the project RPC value.
    state.finances = { mer: financesFor(meridian, { mapped: false }) };
    renderDashboard();
    const card = areaFor('Meridian');
    expect(screen.getByTestId('kpi-margin-to-date')).toHaveTextContent('$2.5M');
    expect(within(card).getByText('Margin to date')).toBeInTheDocument();
    expect(within(card).getByText('$2.5M')).toBeInTheDocument();
  });

  it('C4: unknown project number, client and spending are left out — no "—" in the card — and the reason is said once on the page', () => {
    const unknown = makeProject({
      id: 'u', name: 'Unknown Spend', status: 'Ongoing Project', client_name: null, spent: null,
      actual_complete: false, realized_margin: null, contract_remaining: null,
    });
    state.projects.data = [unknown];
    state.finances = { u: financesFor(unknown) };
    state.projectDetails = { u: { data: { pmo_project_number: null }, isPending: false, isError: false, refetch: vi.fn() } };
    renderDashboard();
    const card = areaFor('Unknown Spend');
    expect(within(card).queryByText('—')).not.toBeInTheDocument();
    expect(within(card).queryByText('Contract spent')).not.toBeInTheDocument();
    expect(card).toHaveTextContent('USD');
    expect(screen.getAllByText(/Some projects have incomplete spending/)).toHaveLength(1);
    expect(screen.queryByText(/Contract remaining is unavailable/)).not.toBeInTheDocument();
  });

  it('O4: a card with open items leads with them, before its figures; a card with none says so after its figures', () => {
    state.projects.data = [projects[0], projects[1]];
    state.needs.pmOverdueTasksByProject = { p1: 2 };
    renderDashboard();
    const busy = areaFor('Project One');
    const overdue = within(busy).getByRole('link', { name: /2 overdue tasks/i });
    expect(overdue.compareDocumentPosition(within(busy).getByText('Contract')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const quiet = areaFor('Project Two');
    const nothing = within(quiet).getByText('Nothing needs you here.');
    expect(within(quiet).getByText('Contract').compareDocumentPosition(nothing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('L12(h): a two-currency contract total names the organisation currency first, like the company dashboard', () => {
    state.projects.data = [
      makeProject({ id: 'idr', name: 'Rupiah job', status: 'Ongoing Project', currency: 'IDR', actual_currency: 'IDR', budget_currency: 'IDR', contract_value: 269_000_000 }),
      makeProject({ id: 'usd', name: 'Dollar job', status: 'Ongoing Project', contract_value: 33_100_000 }),
    ];
    renderDashboard();
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$33.1M · IDR 269M');
  });
});
