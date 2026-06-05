import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';
import { formatCurrency } from '@/src/lib/format';

// Oracle payload — extended dual-lens fields (no avg_gross_margin)
const populated = {
  active_projects: 2,
  total_contract_value: 8000000,
  on_hand_margin: 0.949375,
  on_hand_value: 8000000,
  pipeline_weighted_value: 800000,
  pipeline_projected_margin: 0.200,
  pipeline_total_value: 2000000,
  projects_at_risk: 1,
  projects_by_status: [
    { status: 'Ongoing Project', count: 2 },
    { status: 'Tender Submitted', count: 1 },
    { status: 'PQ Submitted', count: 1 },
  ],
  procurements_by_status: [
    { status: 'Draft', count: 1 }, { status: 'Requested', count: 1 }, { status: 'Vendor Quoted', count: 1 },
    { status: 'Ordered', count: 1 }, { status: 'Paid', count: 1 },
  ],
  top_projects: [
    { id: 'p1', name: 'Innovate Corp HQ Fit-Out', client_name: 'Innovate Corp',
      contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project' },
    { id: 'p3', name: 'Acme Internal Platform', client_name: 'Innovate Corp',
      contract_value: 3000000, budget: 2000000, spent: 1900000, status: 'Ongoing Project' },
  ],
};

// Oracle win-rate — all-time §3.8
const winRateOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8000000, losses_value: 650000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
};

// Track calls to useWinRate so AC-1115 can assert range changes
let lastWinRateRange: { key: string } | null = null;

const dashState: {
  data: typeof populated | null;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: populated, isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => dashState,
  useWinRate: (range: { key: string }) => {
    lastWinRateRange = range;
    return { data: winRateOracle, isPending: false, isError: false };
  },
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive' }) }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

const renderPage = () => render(<MemoryRouter><ExecutiveDashboard /></MemoryRouter>);

describe('ExecutiveDashboard (real data)', () => {
  it('renders Active Projects = 2 and Total Contract Value $8,000,000 (AC-701)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByTestId('kpi-active-projects')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-total-contract-value')).toHaveTextContent('$8,000,000');
  });
  it('pipeline region shows the Ongoing count 2 (AC-703)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByTestId('dashboard-pipeline')).toHaveTextContent('2');
  });
  it('procurement-by-status region shows 5 statuses (AC-704)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByTestId('dashboard-proc-status')).toHaveTextContent('5');
  });
  it('top projects table shows joined client name (AC-705)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
  });
});

describe('ExecutiveDashboard states', () => {
  it('loading skeleton while pending (AC-706)', () => {
    dashState.isPending = true; dashState.isError = false;
    renderPage();
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    dashState.isPending = false;
  });
  it('error state with retry (AC-707)', () => {
    dashState.isError = true; dashState.isPending = false;
    renderPage();
    expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    dashState.isError = false;
  });
  it('empty state when org has no projects/procurements (AC-708)', () => {
    dashState.data = {
      active_projects: 0, total_contract_value: 0,
      on_hand_margin: 0, on_hand_value: 0, pipeline_weighted_value: 0,
      pipeline_projected_margin: 0, pipeline_total_value: 0, projects_at_risk: 0,
      projects_by_status: [], procurements_by_status: [], top_projects: [],
    };
    dashState.isPending = false; dashState.isError = false;
    renderPage();
    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
    dashState.data = populated;
  });
});

describe('ExecutiveDashboard dual-lens tiles (AC-1114 / FR-SPD-012)', () => {
  it('AC-1114: renders on-hand margin / pipeline weighted value / projected margin tiles, no avg_gross_margin (FR-SPD-012)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();

    // on-hand margin = 0.949375 → 94.9%
    expect(screen.getByTestId('kpi-on-hand-margin')).toHaveTextContent('94.9%');

    // pipeline weighted value = 800000
    expect(screen.getByTestId('kpi-pipeline-weighted-value')).toHaveTextContent(formatCurrency(800000));

    // pipeline projected margin = 0.200 → 20.0%
    expect(screen.getByTestId('kpi-pipeline-projected-margin')).toHaveTextContent('20.0%');

    // old tile must not exist
    expect(screen.queryByTestId('kpi-avg-gross-margin')).toBeNull();
  });
});

describe('ExecutiveDashboard win-rate widget (AC-1115 / FR-SPD-013)', () => {
  it('AC-1115: win-rate tile toggles count↔value and period re-queries (FR-SPD-013)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    lastWinRateRange = null;
    renderPage();

    // default mode = count → 66.7%
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');

    // toggle to value → 92.5%
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('92.5%');

    // reset toggle back to count
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');

    // changing period selector changes range key
    const initialKey = lastWinRateRange?.key;
    fireEvent.change(screen.getByTestId('win-rate-period'), { target: { value: 'q' } });
    expect(lastWinRateRange?.key).not.toBe(initialKey);
  });
});
