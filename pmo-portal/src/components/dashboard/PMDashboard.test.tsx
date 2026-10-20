import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PMDashboard } from './PMDashboard';
import { BahasaProvider } from '@/test/bahasa';

const mine = [
  { id: 'p1', name: 'My Project A', contract_value: 4_000_000, currency: 'USD', budget: 3_000_000, spent: 1_000_000, realized_margin_pct: 0.25, contract_remaining: 3_000_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client_name: 'Acme', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
  { id: 'p2', name: 'My Project B', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 980_000, realized_margin_pct: null, contract_remaining: 1_020_000, status: 'Won, Pending KoM', project_manager_id: 'pm-1', client_name: 'Beta', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
  { id: 'p3', name: 'My Project C', contract_value: 1_000_000, currency: 'USD', budget: 500_000, spent: 100_000, realized_margin_pct: null, contract_remaining: 900_000, status: 'Loss Tender', project_manager_id: 'pm-1', client_name: null },
  { id: 'p4', name: 'My Project D', contract_value: 1_000_000, currency: 'USD', budget: 500_000, spent: 100_000, realized_margin_pct: null, contract_remaining: 900_000, status: 'On Hold', project_manager_id: 'pm-1', client_name: null },
  { id: 'p5', name: 'My Project E', contract_value: 1_000_000, currency: 'USD', budget: 500_000, spent: 100_000, realized_margin_pct: null, contract_remaining: 900_000, status: 'Leads', project_manager_id: 'pm-1', client_name: null },
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

const renderPane = (locale: 'en' | 'id' = 'en') => render(
  <BahasaProvider locale={locale}>
    <MemoryRouter><PMDashboard /></MemoryRouter>
  </BahasaProvider>,
);

beforeEach(() => {
  projState.data = mine;
  projState.isPending = false;
  projState.isError = false;
});

describe('PMDashboard (real — my projects + timesheets awaiting)', () => {
  it('AC-UXA-001: localizes PM copy and project statuses without changing values or destinations', () => {
    renderPane('id');
    expect(screen.getByRole('heading', { name: 'Dashboard saya' })).toBeInTheDocument();
    expect(screen.getByText('Proyek saya')).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'Bantuan: Proyek saya' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Proyek yang ditetapkan kepada Anda sebagai manajer proyek.');
    expect(screen.getByRole('link', { name: 'Buka proyek saya' })).toHaveAttribute('href', '/projects?filter=My+Projects');
    expect(screen.getByText('Menang — menunggu rapat awal')).toBeInTheDocument();
    expect(screen.getByText('Pengeluaran dibanding kontrak')).toBeInTheDocument();
    expect(screen.getByText('Status Proyek')).toBeInTheDocument();
    expect(screen.getAllByText(/Belum tersedia|Not available yet/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('US$9.000.000,00');
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'Buka proyek saya yang berisiko' })).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(screen.getAllByRole('link', { name: 'My Project B' }).every((link) => link.getAttribute('href') === '/projects/p2')).toBe(true);
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
    expect(screen.getByText('Belum ada proyek yang ditetapkan kepada Anda')).toBeInTheDocument();
    expect(screen.getByText('Proyek yang Anda kelola akan muncul di sini.')).toBeInTheDocument();
  });
  it('counts only my projects (5 of 6)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('5');
  });
  it('sums my contract value, not the whole org', () => {
    renderPane();
    // The server read model supplies assigned projects only; the display preserves the row currency.
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$9,000,000.00');
  });
  it('AC-RD-RISK-001: says risk cannot be checked when active projects have no usable budgets', () => {
    projState.data = [
      { id: 'p-unknown', name: 'Unbudgeted project', contract_value: null, currency: 'USD', budget: null, spent: null, realized_margin_pct: null, contract_remaining: null, status: 'Ongoing Project', project_manager_id: 'pm-1', actual_complete: false, actual_currency: null, budget_currency: null },
    ];
    renderPane();
    const tile = screen.getByTestId('kpi-at-risk');
    expect(tile).toHaveTextContent("Can't be checked yet");
    expect(tile).toHaveTextContent(/active budget/i);
    expect(tile).not.toHaveTextContent(/\b0\b|all on track/i);
  });
  it('renders exactly one at-risk tile in the KPI band, with its drillthrough and help', () => {
    renderPane();
    const atRiskTiles = screen.getAllByTestId('kpi-at-risk');
    expect(atRiskTiles).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Attention and approvals' })).queryByText(/^At risk$/)).not.toBeInTheDocument();
    expect(atRiskTiles[0]).toHaveTextContent('budget usage > 90%');
    expect(within(atRiskTiles[0]).getByRole('link')).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(within(atRiskTiles[0]).getByRole('button', { name: /Help: At risk/i })).toBeInTheDocument();
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
  it('renders a toned status pill per project status (won/lost/on-hold/neutral)', () => {
    renderPane();
    expect(screen.getByText('Won, Pending KoM')).toBeInTheDocument();
    expect(screen.getByText('Loss Tender')).toBeInTheDocument();
    expect(screen.getByText('On Hold')).toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
  });
  it('UIP-011: every Project Status name is an accessible, correctly routed project link', () => {
    renderPane();
    const statusCard = screen.getByRole('region', { name: 'Project Status' });

    for (const project of mine) {
      const projectLink = within(statusCard).getByRole('link', { name: project.name });
      expect(projectLink).toHaveAttribute('href', `/projects/${project.id}`);
      expect(projectLink.className).toContain('focus-visible:outline');
    }

    expect(within(statusCard).queryByRole('link', { name: other.name })).not.toBeInTheDocument();
  });
});

describe('PMDashboard KPI grid — monotonic arbitrary breakpoints (C1)', () => {
  it('KPI band uses only arbitrary min-[] variants — no named sm: mixed in', () => {
    const { container } = renderPane();
    const band = container.querySelector('[aria-label="My KPIs"]') as HTMLElement;
    expect(band.className).toContain('min-[560px]:grid-cols-2');
    expect(band.className).toContain('min-[1180px]:grid-cols-4');
    expect(band.className).not.toContain('sm:grid-cols');
  });
});

describe('PMDashboard Project Status margin — no false-green (I2)', () => {
  it('AC-UX-015: names the trailing metric and shows billed-work margin, not contract remainder', () => {
    // mine fixture: p1=Ongoing+spend, p2=Won pending (not active), p3=Loss Tender (not active), p4=On Hold, p5=Leads
    renderPane();
    // Server read model reports 25% profit margin on billed work.
    const allText = document.body.textContent ?? '';
    expect(allText).toContain('25.0%');
    // G3: non-active Project-Status rows read a concrete "Not set" margin value,
    // never a bare em-dash placeholder (the "—" in the section heading separator
    // is typographic, not a value placeholder, so we scope to the list rows).
    const listItems = document.querySelectorAll('ul li');
    const lossTenderItem = [...listItems].find((li) => li.textContent?.includes('My Project C'));
    expect(lossTenderItem?.textContent).toMatch(/Belum tersedia|Not available yet/);
    expect(lossTenderItem?.textContent).not.toContain('—');
    expect(lossTenderItem?.textContent).not.toMatch(/\d+\.\d+%/);
  });
  it('does not emit text-success on non-active project margin cells', () => {
    const { container } = renderPane();
    const listItems = container.querySelectorAll('ul li');
    const lossTenderItem = [...listItems].find((li) => li.textContent?.includes('My Project C'));
    // The margin span must NOT carry text-success
    const marginSpan = lossTenderItem?.querySelector('span:last-child');
    expect(marginSpan?.className).not.toContain('text-success');
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
    // At least one Retry button (both cards show error).
    expect(screen.getAllByRole('button', { name: /Retry/i }).length).toBeGreaterThan(0);
  });
  it('shows an empty state when no projects are assigned to me', () => {
    projState.data = [];
    renderPane();
    expect(screen.getByText(/No projects assigned to you yet/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-AT-RISK-INACTIVE — inactive projects must NOT inflate the at-risk KPI
// ---------------------------------------------------------------------------

describe('AC-AT-RISK-INACTIVE: at-risk KPI excludes inactive projects', () => {
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
    // Only the active one qualifies — count must be 1, not 2
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
  });

  it('AC-AT-RISK-INACTIVE: an active project at 95% budget utilization IS counted as at-risk', () => {
    projState.data = [
      { id: 'p-active', name: 'Active At Risk', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 950_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: null, pm: null, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
    ];
    renderPane();
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
  });
});

// ---------------------------------------------------------------------------
// AC-W3-G2 — Project Status card loading/error states
// ---------------------------------------------------------------------------

describe('AC-W3-G2: PMDashboard "Project Status" card handles loading and error', () => {
  it('AC-W3-G2: isPending → Project Status card shows loading state, not empty state', () => {
    projState.isPending = true; projState.data = undefined;
    renderPane();
    // There must be at least 2 loading skeletons — one per card (BvA + Project Status).
    const loaders = screen.getAllByTestId('liststate-loading');
    expect(loaders.length).toBeGreaterThanOrEqual(2);
    // The empty "Nothing to show yet" must NOT appear.
    expect(screen.queryByText(/Nothing to show yet/i)).toBeNull();
  });

  it('AC-W3-G2: isError → Project Status card shows error + retry, not empty state', () => {
    projState.isError = true; projState.data = undefined;
    renderPane();
    // There must be at least 2 Retry buttons — one per card (BvA + Project Status).
    const retryButtons = screen.getAllByRole('button', { name: /Retry/i });
    expect(retryButtons.length).toBeGreaterThanOrEqual(2);
    // The empty "Nothing to show yet" must NOT appear.
    expect(screen.queryByText(/Nothing to show yet/i)).toBeNull();
  });

  it('AC-W3-G2: populated → Project Status card still shows the project list', () => {
    projState.data = mine; projState.isPending = false; projState.isError = false;
    renderPane();
    // All my projects appear (multiple elements OK — BvA chart + Project Status list).
    expect(screen.getAllByText('My Project A').length).toBeGreaterThan(0);
    // No loading or error states.
    expect(screen.queryByTestId('liststate-loading')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });
});
