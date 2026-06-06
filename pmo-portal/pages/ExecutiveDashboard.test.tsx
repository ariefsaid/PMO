import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
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

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ExecutiveDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  dashState.isPending = false; dashState.isError = false; dashState.data = populated;
});

describe('ExecutiveDashboard (real data)', () => {
  it('renders Active Projects = 2 and Total Contract Value $8,000,000 (AC-701)', () => {
    renderPage();
    expect(screen.getByTestId('kpi-active-projects')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-total-contract-value')).toHaveTextContent('$8,000,000');
  });
  it('budget-vs-actual region surfaces the active project count (AC-703)', () => {
    renderPage();
    expect(screen.getByTestId('dashboard-pipeline')).toHaveTextContent('2');
  });
  it('procurement-by-status region shows 5 statuses (AC-704)', () => {
    renderPage();
    expect(screen.getByTestId('dashboard-proc-status')).toHaveTextContent('5');
  });
  it('budget-vs-actual list shows the project names (AC-705)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getByText('Acme Internal Platform')).toBeInTheDocument();
  });
});

describe('ExecutiveDashboard states', () => {
  it('loading skeleton while pending (AC-706)', () => {
    dashState.isPending = true; dashState.isError = false;
    renderPage();
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
  });
  it('error state with retry (AC-707)', () => {
    dashState.isError = true; dashState.isPending = false;
    renderPage();
    expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
  it('empty state when org has no projects/procurements (AC-708)', () => {
    dashState.data = {
      active_projects: 0, total_contract_value: 0,
      on_hand_margin: 0, on_hand_value: 0, pipeline_weighted_value: 0,
      pipeline_projected_margin: 0, pipeline_total_value: 0, projects_at_risk: 0,
      projects_by_status: [], procurements_by_status: [], top_projects: [],
    };
    renderPage();
    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
  });
});

describe('ExecutiveDashboard dual-lens tiles (AC-1114 / FR-SPD-012)', () => {
  it('AC-1114: renders on-hand margin / pipeline weighted value / projected margin tiles, no avg_gross_margin (FR-SPD-012)', () => {
    renderPage();
    expect(screen.getByTestId('kpi-on-hand-margin')).toHaveTextContent('94.9%');
    expect(screen.getByTestId('kpi-pipeline-weighted-value')).toHaveTextContent(formatCurrency(800000));
    // projected margin tile defaults to the on-hand lens (94.9%)
    expect(screen.getByTestId('kpi-pipeline-projected-margin')).toHaveTextContent('94.9%');
    expect(screen.queryByTestId('kpi-avg-gross-margin')).toBeNull();
  });

  it('AC-1114: the projected-margin tile toggles lens on-hand↔weighted (FR-SPD-012)', () => {
    renderPage();
    const tile = screen.getByTestId('kpi-pipeline-projected-margin');
    // on-hand lens = on_hand_margin 94.9%
    expect(tile).toHaveTextContent('94.9%');
    // toggle to the weighted lens → pipeline_projected_margin 20.0%
    fireEvent.click(screen.getByRole('tab', { name: /Weighted/i }));
    expect(tile).toHaveTextContent('20.0%');
  });
});

describe('ExecutiveDashboard win-rate widget (AC-1115 / FR-SPD-013)', () => {
  it('AC-1115: win-rate tile toggles count↔value and period re-queries (FR-SPD-013)', () => {
    lastWinRateRange = null;
    renderPage();
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('92.5%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');

    const initialKey = lastWinRateRange?.key;
    fireEvent.click(screen.getByTestId('win-rate-period-q'));
    expect(lastWinRateRange?.key).not.toBe(initialKey);
  });
});

describe('ExecutiveDashboard token purity / no mockData', () => {
  it('does not render legacy gray/dark utility classes on the KPI band', () => {
    const { container } = renderPage();
    const band = container.querySelector('[aria-label="Portfolio KPIs"]') as HTMLElement;
    expect(band).toBeTruthy();
    expect(band.querySelector('.text-gray-500')).toBeNull();
    expect(band.querySelector('.dark\\:text-gray-400')).toBeNull();
  });

  it('reflows the KPI band 1→2→3→6 using monotonic arbitrary breakpoints only (C1 — no named sm: mixed in)', () => {
    const { container } = renderPage();
    const band = container.querySelector('[aria-label="Portfolio KPIs"]') as HTMLElement;
    // All tiers must be arbitrary min-[] to avoid Tailwind v4 cascade-order bug
    expect(band.className).toContain('grid-cols-1');
    expect(band.className).toContain('min-[560px]:grid-cols-2');
    expect(band.className).toContain('min-[920px]:grid-cols-3');
    expect(band.className).toContain('min-[1180px]:grid-cols-6');
    // Named sm: MUST NOT appear on grid-cols — it would override all arbitrary tiers at ≥640px
    expect(band.className).not.toContain('sm:grid-cols');
  });
});
