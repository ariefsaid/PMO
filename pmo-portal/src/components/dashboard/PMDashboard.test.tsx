import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PMDashboard } from './PMDashboard';

const mine = [
  { id: 'p1', name: 'My Project A', contract_value: 4_000_000, budget: 3_000_000, spent: 1_000_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: { name: 'Acme' }, pm: null },
  { id: 'p2', name: 'My Project B', contract_value: 2_000_000, budget: 1_000_000, spent: 980_000, status: 'Won, Pending KoM', project_manager_id: 'pm-1', client: { name: 'Beta' }, pm: null },
  { id: 'p3', name: 'My Project C', contract_value: 1_000_000, budget: 500_000, spent: 100_000, status: 'Loss Tender', project_manager_id: 'pm-1', client: null, pm: null },
  { id: 'p4', name: 'My Project D', contract_value: 1_000_000, budget: 500_000, spent: 100_000, status: 'On Hold', project_manager_id: 'pm-1', client: null, pm: null },
  { id: 'p5', name: 'My Project E', contract_value: 1_000_000, budget: 500_000, spent: 100_000, status: 'Leads', project_manager_id: 'pm-1', client: null, pm: null },
];
const other = { id: 'p9', name: 'Someone Else', contract_value: 9_000_000, budget: 1, spent: 0, status: 'Ongoing Project', project_manager_id: 'pm-2', client: null, pm: null };

const projState: { data: unknown[] | undefined; isPending: boolean; isError: boolean } = {
  data: [...mine, other], isPending: false, isError: false,
};

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ ...projState, refetch: vi.fn() }),
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
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
}));

const renderPane = () => render(<MemoryRouter><PMDashboard /></MemoryRouter>);

beforeEach(() => {
  projState.data = [...mine, other];
  projState.isPending = false;
  projState.isError = false;
});

describe('PMDashboard (real — my projects + timesheets awaiting)', () => {
  it('counts only my projects (5 of 6)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('5');
  });
  it('sums my contract value, not the whole org', () => {
    renderPane();
    // 4M + 2M + 1M + 1M + 1M = 9M (excludes the other PM's 9M)
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$9,000,000');
  });
  it('counts my at-risk projects (utilization > 90%)', () => {
    renderPane();
    // only Project B is 98% utilized → 1 at-risk
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
  });
  it('N15: combined approvals tile = approvable PRs (1) + timesheets (2) = 3, links to /approvals', () => {
    renderPane();
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent('3');
    expect(tile).toHaveAttribute('href', '/approvals');
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
  it('G3/I2: shows margin for active ongoing projects only — "Not set" (no em-dash) for non-active rows', () => {
    // mine fixture: p1=Ongoing+spend, p2=Won pending (not active), p3=Loss Tender (not active), p4=On Hold, p5=Leads
    renderPane();
    // p1: Ongoing, spent=1M, contract=4M → margin = (4M-1M)/4M = 75% → should show a % figure
    const allText = document.body.textContent ?? '';
    expect(allText).toContain('75.0%');
    // G3: non-active Project-Status rows read a concrete "Not set" margin value,
    // never a bare em-dash placeholder (the "—" in the section heading separator
    // is typographic, not a value placeholder, so we scope to the list rows).
    const listItems = document.querySelectorAll('ul li');
    const lossTenderItem = [...listItems].find((li) => li.textContent?.includes('My Project C'));
    expect(lossTenderItem?.textContent).toContain('Not set');
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
    projState.data = [other];
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
      { id: 'p-active', name: 'Active At Risk', contract_value: 2_000_000, budget: 1_000_000, spent: 950_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: null, pm: null },
      // Inactive (Loss Tender), 95% utilized → must NOT count
      { id: 'p-inactive', name: 'Inactive At Risk', contract_value: 2_000_000, budget: 1_000_000, spent: 950_000, status: 'Loss Tender', project_manager_id: 'pm-1', client: null, pm: null },
    ];
    renderPane();
    // Only the active one qualifies — count must be 1, not 2
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
  });

  it('AC-AT-RISK-INACTIVE: an active project at 95% budget utilization IS counted as at-risk', () => {
    projState.data = [
      { id: 'p-active', name: 'Active At Risk', contract_value: 2_000_000, budget: 1_000_000, spent: 950_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: null, pm: null },
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
    projState.data = [...mine, other]; projState.isPending = false; projState.isError = false;
    renderPane();
    // All my projects appear (multiple elements OK — BvA chart + Project Status list).
    expect(screen.getAllByText('My Project A').length).toBeGreaterThan(0);
    // No loading or error states.
    expect(screen.queryByTestId('liststate-loading')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });
});
