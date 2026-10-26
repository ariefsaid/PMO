import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { PMDashboard } from './PMDashboard';
import { PageFrame } from '@/src/components/shell';
import { BahasaProvider } from '@/test/bahasa';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const mine = [
  { id: 'p1', name: 'My Project A', contract_value: 4_000_000, currency: 'USD', budget: 3_000_000, spent: 1_000_000, realized_margin_pct: 0.25, contract_remaining: 3_000_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client_name: 'Acme', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
  { id: 'p2', name: 'My Project B', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 980_000, realized_margin_pct: null, contract_remaining: 1_020_000, status: 'Won, Pending KoM', project_manager_id: 'pm-1', client_name: 'Beta', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
  { id: 'p3', name: 'My Project C', contract_value: 1_000_000, currency: 'USD', budget: 500_000, spent: 100_000, realized_margin_pct: null, contract_remaining: 900_000, status: 'Loss Tender', project_manager_id: 'pm-1', client_name: null },
  { id: 'p4', name: 'My Project D', contract_value: 1_000_000, currency: 'USD', budget: 500_000, spent: 100_000, realized_margin_pct: null, contract_remaining: 900_000, status: 'On Hold', project_manager_id: 'pm-1', client_name: null },
  { id: 'p5', name: 'My Project E', contract_value: 1_000_000, currency: 'USD', budget: 500_000, spent: 100_000, realized_margin_pct: null, contract_remaining: 900_000, status: 'Leads', project_manager_id: 'pm-1', client_name: null },
  { id: 'p6', name: 'My Project F', contract_value: 3_600_000, currency: 'USD', budget: 2_000_000, spent: 500_000, realized_margin_pct: null, contract_remaining: 1_500_000, status: 'Close Out', project_manager_id: 'pm-1', client_name: null },
];
const other = { id: 'p9', name: 'Someone Else', contract_value: 9_000_000, budget: 1, spent: 0, status: 'Ongoing Project', project_manager_id: 'pm-2', client: null, pm: null };

const projState: { data: unknown[] | undefined; isPending: boolean; isError: boolean } = {
  data: mine, isPending: false, isError: false,
};

vi.mock('@/src/hooks/useDashboard', () => ({
  usePMDashboardProjects: () => ({ ...projState, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [{ id: 't1' }, { id: 't2' }], isPending: false, isError: false, refetch: vi.fn() }),
}));
// The combined approvals tile (N15) also reads procurements + the real role.
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: [
      { id: 'pr1', status: 'Requested', requested_by_id: 'someone-else' },
    ],
    isPending: false,
  }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
// FR-L10N-020: dashboard aggregates are org-denominated (the RPC rows carry no currency of their
// own), so the component reads useOrgCurrency and the test pins it rather than leaving it to a
// real query. ⛑ At line-start on purpose — an earlier automated insert landed it INSIDE the
// vi.mock call below, which parses as a syntax error rather than a wrong value.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
}));

const renderPane = (locale: 'en' | 'id' = 'en') => {
  setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
  return render(
  <BahasaProvider locale={locale}>
    <MemoryRouter>
      <PageFrame breadcrumb={[
        { label: locale === 'id' ? 'Beranda' : 'Home', href: '/' },
        { label: locale === 'id' ? 'Dasbor' : 'Dashboard' },
      ]}>
        <PMDashboard />
      </PageFrame>
      <LocationProbe />
    </MemoryRouter>
  </BahasaProvider>,
  );
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pm-dashboard-search">{location.search}</output>;
}

beforeEach(() => {
  projState.data = mine;
  projState.isPending = false;
  projState.isError = false;
});

describe('PMDashboard (real — my projects + timesheets awaiting)', () => {
  it('AC-806-PM-01: merges delivery status and spending into one risk-first, URL-stateful worklist', () => {
    renderPane();

    expect(screen.getByRole('heading', { name: 'My delivery projects' })).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^pm-project-row-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'pm-project-row-p2', 'pm-project-row-p1', 'pm-project-row-p4', 'pm-project-row-p6',
    ]);
    expect(screen.queryByTestId('kpi-my-projects')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-my-contract-value')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-at-risk')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Project Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Spending vs contract' })).not.toBeInTheDocument();

    const projectB = screen.getByTestId('pm-project-row-p2');
    expect(within(projectB).getByText('USD')).toBeVisible();
    expect(within(projectB).getAllByText('USD')).toHaveLength(1);
    const evidence = within(projectB).getByRole('button', { name: /evidence.*my project b/i });
    expect(evidence).toHaveTextContent('Evidence');
    fireEvent.click(evidence);
    expect(screen.getByTestId('pm-dashboard-search')).toHaveTextContent('pmProjectEvidence=p2');
    expect(within(projectB).getByText('980,000')).toBeInTheDocument();
    expect(within(projectB).getByText('2,000,000')).toBeInTheDocument();
    expect(within(projectB).getAllByText('USD')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open budget for My Project B' })).toHaveTextContent('Open budget');
    expect(screen.getByRole('link', { name: 'Open budget for My Project B' })).toHaveAttribute('href', '/projects/p2/budget');
    expect(screen.getByRole('progressbar', { name: /My Project B.*49% of contract/i })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('pm-project-sort'), { target: { value: 'name' } });
    expect(screen.getByTestId('pm-dashboard-search')).toHaveTextContent('pmProjectEvidence=p2');
    expect(screen.getByTestId('pm-dashboard-search')).toHaveTextContent('pmSort=name');
    expect(screen.getAllByTestId(/^pm-project-row-/).map((row) => row.getAttribute('data-testid'))).toEqual([
      'pm-project-row-p1', 'pm-project-row-p2', 'pm-project-row-p4', 'pm-project-row-p6',
    ]);
  });

  it('AC-UXA-001: localizes PM copy and project statuses without changing values or destinations', () => {
    renderPane('id');
    expect(screen.getByRole('heading', { name: 'Dashboard saya' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Beranda');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Dasbor');
    expect(screen.getByRole('heading', { name: 'Proyek pelaksanaan saya' })).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-scope')).toHaveTextContent('4 proyek pelaksanaan');
    expect(screen.getByTestId('pm-project-scope')).toHaveTextContent('10.600.000');
    expect(screen.getByText('Menang — menunggu rapat awal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tinjau 1 proyek berisiko' })).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(screen.getByRole('link', { name: 'My Project B' })).toHaveAttribute('href', '/projects/p2');
    expect(mine.find((project) => project.id === 'p2')?.status).toBe('Won, Pending KoM');

    cleanup();
    projState.data = undefined; projState.isPending = true; projState.isError = false;
    renderPane('id');
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Memuat…').length).toBeGreaterThan(0);

    cleanup();
    projState.data = undefined; projState.isPending = false; projState.isError = true;
    renderPane('id');
    expect(screen.getAllByText('Gagal memuat proyek Anda').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Coba lagi' }).length).toBeGreaterThan(0);

    cleanup();
    projState.data = []; projState.isPending = false; projState.isError = false;
    renderPane('id');
    expect(screen.getByText('Belum ada proyek pengiriman yang ditetapkan kepada Anda')).toBeInTheDocument();
    expect(screen.getByText('Proyek dalam tahap pengiriman akan muncul di sini.')).toBeInTheDocument();
  });
  it('counts on-hand and internal delivery projects, including Close Out', () => {
    renderPane();
    expect(screen.getByTestId('pm-project-scope')).toHaveTextContent('4 delivery projects');
  });
  it('sums my delivery contract value including Close Out, not the whole org', () => {
    renderPane();
    expect(screen.getByTestId('pm-project-scope')).toHaveTextContent('USD 10,600,000');
    expect(screen.getByTestId('pm-project-scope')).not.toHaveTextContent('Someone Else');
  });
  it('AC-RD-RISK-001: says risk cannot be checked when active projects have no usable budgets', () => {
    projState.data = [
      { id: 'p-unknown', name: 'Unbudgeted project', contract_value: null, currency: 'USD', budget: null, spent: null, realized_margin_pct: null, contract_remaining: null, status: 'Ongoing Project', project_manager_id: 'pm-1', actual_complete: false, actual_currency: null, budget_currency: null },
    ];
    renderPane();
    expect(screen.getByTestId('pm-risk-unavailable-p-unknown')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-data-note')).toHaveTextContent('Risk needs a positive active budget');
    expect(screen.queryByText(/all on track/i)).not.toBeInTheDocument();
  });
  it('renders one quiet at-risk doorway in the project scope', () => {
    renderPane();
    expect(screen.getAllByTestId('dashboard-at-risk-link')).toHaveLength(1);
    expect(screen.getByTestId('dashboard-at-risk-link')).toHaveAttribute('href', '/projects?filter=at-risk');
  });
  it('N15: combined approvals tile = approvable PRs (1) + timesheets (2) = 3, links to /approvals', () => {
    renderPane();
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent('3');
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/approvals');
  });
  it('does NOT render a procurement-approvals coming-soon placeholder (removed; tracked in backlog)', () => {
    renderPane();
    expect(screen.queryByText(/Procurement approvals — coming soon/i)).not.toBeInTheDocument();
  });
  it('renders each assigned delivery status, including Close Out; pre-win statuses are not listed', () => {
    renderPane();
    expect(screen.getByText('Won, Pending KoM')).toBeInTheDocument();
    expect(screen.getByText('On Hold')).toBeInTheDocument();
    expect(screen.getByText('Close Out')).toBeInTheDocument();
    expect(screen.queryByText('Loss Tender')).toBeNull();
    expect(screen.queryByText('Leads')).toBeNull();
  });
  it('UIP-011: every worklist project name is an accessible, correctly routed project link', () => {
    renderPane();
    for (const project of mine.filter((m) => !['Loss Tender', 'Leads'].includes(m.status))) {
      const projectLink = within(screen.getByTestId(`pm-project-row-${project.id}`)).getByRole('link', { name: project.name });
      expect(projectLink).toHaveAttribute('href', `/projects/${project.id}`);
    }
    expect(screen.queryByRole('link', { name: other.name })).not.toBeInTheDocument();
  });
});

describe('PMDashboard worklist margin — no false values (I2)', () => {
  it('AC-UX-015: names the trailing metric and shows billed-work margin, not contract remainder', () => {
    renderPane();
    const marginRow = within(screen.getByTestId('pm-project-row-p1'));
    expect(marginRow.getByText('Margin to date')).toBeInTheDocument();
    expect(marginRow.getByRole('img', { name: 'My Project A margin to date: 25.0%' })).toHaveTextContent('25.0%');
    const unknownMarginRow = within(screen.getByTestId('pm-project-row-p2'));
    expect(unknownMarginRow.getByRole('img', { name: 'Margin unavailable' })).toHaveTextContent('—');
  });
});

describe('PMDashboard states', () => {
  it('shows a loading skeleton while projects are pending', () => {
    projState.isPending = true; projState.data = undefined;
    renderPane();
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  });
  it('shows an error + retry when the projects query fails', () => {
    projState.isError = true; projState.data = undefined;
    renderPane();
    expect(screen.getByRole('heading', { name: 'My delivery projects' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Retry/i })).toHaveLength(1);
  });
  it('shows a delivery-scoped empty state when assignments are only pre-win projects', () => {
    projState.data = [mine[4]];
    renderPane();
    expect(screen.getByText(/No delivery projects assigned to you yet/i)).toBeInTheDocument();
    expect(screen.getByText('Projects in the delivery phase will appear here.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-AT-RISK-INACTIVE — inactive projects must NOT inflate the at-risk count
// ---------------------------------------------------------------------------

describe('AC-AT-RISK-INACTIVE: worklist excludes inactive projects from risk', () => {
  it('AC-AT-RISK-INACTIVE: a Loss Tender project at 95% budget utilization is NOT counted as at-risk', () => {
    // Override projState with one active at-risk project + one inactive at-risk project.
    // Only the active one should count.
    projState.data = [
      // Active, 95% utilized → should count
      { id: 'p-active', name: 'Active At Risk', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 950_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: null, pm: null, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
      // Inactive (Loss Tender), 95% utilized → must NOT count
      { id: 'p-inactive', name: 'Inactive At Risk', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 950_000, status: 'Loss Tender', project_manager_id: 'pm-1', client: null, pm: null, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
    ];
    renderPane();
    expect(screen.getByTestId('dashboard-at-risk-link')).toHaveAccessibleName('Review 1 at-risk project');
    expect(screen.getByTestId('pm-project-row-p-active')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-project-row-p-inactive')).not.toBeInTheDocument();
  });

  it('AC-AT-RISK-INACTIVE: an active project at 95% budget utilization IS counted as at-risk', () => {
    projState.data = [
      { id: 'p-active', name: 'Active At Risk', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 950_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: null, pm: null, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
    ];
    renderPane();
    expect(screen.getByTestId('dashboard-at-risk-link')).toHaveAccessibleName('Review 1 at-risk project');
  });
});

// ---------------------------------------------------------------------------
// AC-W3-G2 — merged worklist loading/error states
// ---------------------------------------------------------------------------

describe('AC-W3-G2: PMDashboard worklist retains its frame while loading and on error', () => {
  it('AC-W3-G2: isPending → worklist keeps its heading and loading state', () => {
    projState.isPending = true; projState.data = undefined;
    renderPane();
    expect(screen.getByRole('heading', { name: 'My delivery projects' })).toBeInTheDocument();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-projects-empty')).not.toBeInTheDocument();
  });

  it('AC-W3-G2: isError → worklist keeps one local retry, not an empty state', () => {
    projState.isError = true; projState.data = undefined;
    renderPane();
    expect(screen.getByRole('heading', { name: 'My delivery projects' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Retry/i })).toHaveLength(1);
    expect(screen.queryByTestId('pm-projects-empty')).not.toBeInTheDocument();
  });

  it('AC-W3-G2: populated → one worklist shows each project once', () => {
    projState.data = mine; projState.isPending = false; projState.isError = false;
    renderPane();
    expect(screen.getAllByTestId(/^pm-project-row-/)).toHaveLength(4);
    expect(within(screen.getByTestId('pm-project-row-p1')).getAllByRole('link', { name: 'My Project A' })).toHaveLength(1);
    expect(screen.queryByTestId('liststate-loading')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });
});

describe('AC-1238: PM dashboard counts only active-delivery projects', () => {
  it('AC-1238-001: delivery surfaces include Close Out and exclude lost/pipeline rows', () => {
    renderPane();
    // Ongoing 4M + Won Pending KoM 2M + On Hold 1M + Close Out 3.6M; Loss Tender + Leads stay excluded.
    expect(screen.getByTestId('pm-project-scope')).toHaveTextContent('4 delivery projects');
    expect(screen.getByTestId('pm-project-scope')).toHaveTextContent('$10,600,000');
    expect(screen.getAllByTestId(/^pm-project-row-/)).toHaveLength(4);
    expect(screen.queryByTestId('pm-project-row-p3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pm-project-row-p5')).not.toBeInTheDocument();
    expect(screen.getByTestId('pm-project-row-p6')).toBeInTheDocument();
  });
  it('AC-1238-001: mixed currencies among delivery projects stay unknown, never summed', () => {
    projState.data = [
      { ...mine[0] },
      { ...mine[1], currency: 'IDR', actual_currency: 'IDR', budget_currency: 'IDR' },
    ];
    renderPane();
    const scope = screen.getByTestId('pm-project-scope');
    expect(scope).toHaveTextContent('USD 4,000,000');
    expect(scope).toHaveTextContent('IDR');
    expect(scope).toHaveTextContent('2,000,000');
    expect(scope).not.toHaveTextContent('USD 6,000,000');
  });
});

describe('AC-1238: PM project-status row legibility', () => {
  it('AC-1238-002: the full project name remains visible and accessible', () => {
    renderPane();
    const link = within(screen.getByTestId('pm-project-row-p2')).getByRole('link', { name: 'My Project B' });
    expect(link).toBeVisible();
  });
  it('AC-1238-003: margin is labelled (visible + accessible name) and every status shares one dot marker', () => {
    projState.data = [mine[0], mine[3]];
    renderPane();
    const row = within(screen.getByTestId('pm-project-row-p1'));
    expect(row.getByText('Margin to date')).toBeInTheDocument();
    expect(row.getByRole('img', { name: 'My Project A margin to date: 25.0%' })).toBeInTheDocument();
    expect(row.getByText('Ongoing Project')).toBeInTheDocument();
  });
});
