import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';
import type { ExecutiveDashboard as ExecutiveDashboardData } from '@/src/lib/db/dashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

type Analytics = typeof import('@/src/lib/analytics');
const analytics = vi.hoisted(() => ({ trackComingSoonClicked: vi.fn<Analytics['trackComingSoonClicked']>() }));
const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));
// OD-BILL-1: the Still-to-invoice card reads through react-query; stubbed like the other dashboard hooks.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...await importOriginal<Analytics>(),
  trackComingSoonClicked: analytics.trackComingSoonClicked,
} satisfies Analytics));

// Oracle payload — extended dual-lens fields (no avg_gross_margin)
const populated = {
  active_projects: 2,
  total_contract_value: 8000000,
  on_hand_margin: 0.949375,
  on_hand_value: 8000000 as number | null,
  on_hand_contract_remaining: 7_595_000 as number | null,
  on_hand_realized_margin: 1_200_000 as number | null,
  on_hand_actual_known: 4_000_000,
  on_hand_actual_project_count: 2,
  on_hand_actual_project_total: 2,
  on_hand_actual_coverage_count: 2,
  on_hand_actual_coverage_total: 2,
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8000000, actual_known: 4000000, contract_remaining: 7595000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 1200000, unknown_projects: 0 }],
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 1200000, unknown_projects: 0 }],
  pipeline_weighted_value: 800000,
  pipeline_projected_margin: 0.200 as number | null,
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
      contract_value: 5000000, currency: 'USD', budget: 4700000, spent: 2100000, status: 'Ongoing Project' },
    { id: 'p3', name: 'Acme Internal Platform', client_name: 'Innovate Corp',
      contract_value: 3000000, currency: 'USD', budget: 2000000, spent: 1900000, status: 'Ongoing Project' },
  ],
};

// Oracle win-rate — all-time §3.8
const winRateOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8000000, losses_value: 650000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
};

// Track calls to useWinRate so AC-1115 can assert range changes.
// Held in a container object (not a bare `let`) so TS's control-flow narrowing
// doesn't collapse the type to `never` across the closure reassignment in the
// useWinRate mock below.
const winRateRangeTracker: { current: { key: string } | null } = { current: null };
// A reset assignment routed through a function (rather than inline `= null`) so
// TS's CFA doesn't narrow `.current` to the literal `null` type at the call site —
// direct inline `null` assignment collapses subsequent `?.` reads to `never`
// (a known TS narrowing quirk for object properties assigned a bare null literal).
function resetWinRateRangeTracker(): void {
  winRateRangeTracker.current = null;
}

const dashState: {
  data: (typeof populated & Pick<ExecutiveDashboardData, 'on_hand_value_by_currency' | 'on_hand_realized_margin_by_currency'>) | null;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: populated, isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => dashState,
  useWinRate: (range: { key: string }) => {
    winRateRangeTracker.current = range;
    return { data: winRateOracle, isPending: false, isError: false };
  },
  useSalesPipeline: () => ({ data: { stages: [{ status: 'Negotiation', count: 1, total_value: 2000000, win_probability: 0.4, weighted_value: 800000 }] }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {}, isLoading: false }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));
// N15 approvals tile reads procurements + the timesheet queue.
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false }),
}));
const approvalState = vi.hoisted(() => ({ timesheets: [{ id: 't1' }] as Array<{ id: string }> }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: approvalState.timesheets }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
// FR-L10N-020: exec-dashboard KPI aggregates are org-denominated (RPC rows carry no currency).
const orgState = vi.hoisted(() => ({ currency: 'USD' }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => orgState.currency }));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ExecutiveDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  desktop.value = true;
  dashState.isPending = false; dashState.isError = false; dashState.data = populated;
  approvalState.timesheets = [{ id: 't1' }];
});

describe('ExecutiveDashboard (real data)', () => {
  it('AC-SL-B-001: no budgets keeps risk unknown and pipeline margin unavailable', () => {
    dashState.data = { ...populated, pipeline_projected_margin: null, projects_at_risk: 0, ...({ active_delivery_projects: 2, risk_unchecked_projects: 2 } as object) } as typeof populated;
    renderPage();
    expect(screen.getByText('Risk is not checked for 2 delivery projects')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Delivery book' })).toHaveTextContent('2 active projects');
    const pipeline = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(pipeline).getByText('Pipeline forecast margin')).toBeInTheDocument();
    expect(within(pipeline).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/Active-budget risk/)).not.toBeInTheDocument();
  });

  it('AC-RD-MONEY-003: in an IDR org a USD on-hand row names its currency by code, never a bare "$"', () => {
    orgState.currency = 'IDR';
    try {
      dashState.data = {
        ...populated,
        on_hand_value: null as unknown as number,
        on_hand_value_by_currency: [
          { currency: 'IDR', contract_value: 373_500_000_000, actual_known: 0, contract_remaining: 0, actual_coverage_count: 1, actual_coverage_total: 1, realized_margin_known: 0, unknown_projects: 0 },
          { currency: 'USD', contract_value: 3_400_000, actual_known: 0, contract_remaining: 0, actual_coverage_count: 1, actual_coverage_total: 1, realized_margin_known: 0, unknown_projects: 0 },
        ],
      };
      renderPage();
      const delivery = screen.getByRole('region', { name: 'Delivery book' });
      expect(delivery).toHaveTextContent('USD $3,400,000');
      expect(delivery).toHaveTextContent('IDR 373,500,000,000');
    } finally {
      orgState.currency = 'USD';
    }
  });

  it('shows on-hand contract amounts per currency when the aggregate is mixed-currency', () => {
    dashState.data = {
      ...populated,
      on_hand_value: null as unknown as number,
      on_hand_contract_remaining: null as unknown as number,
      on_hand_realized_margin: null as unknown as number,
      on_hand_value_by_currency: [
        { currency: 'IDR', contract_value: 2_000_000_000, actual_known: 1_200_000_000, contract_remaining: 800_000_000, actual_coverage_count: 144, actual_coverage_total: 150, realized_margin_known: 100_000_000, unknown_projects: 0 },
        { currency: 'USD', contract_value: 1_000_000, actual_known: null as unknown as number, contract_remaining: null as unknown as number, actual_coverage_count: 0, actual_coverage_total: 150, realized_margin_known: null as unknown as number, unknown_projects: 1 },
      ],
      on_hand_realized_margin_by_currency: [
        { currency: 'IDR', known_amount: 100_000_000, unknown_projects: 0 },
        { currency: 'USD', known_amount: null as unknown as number, unknown_projects: 1 },
      ],
      on_hand_actual_coverage_count: 144,
      on_hand_actual_coverage_total: 150,
    };
    renderPage();
    const delivery = screen.getByRole('region', { name: 'Delivery book' });
    expect(delivery).toHaveTextContent('IDR 2,000,000,000');
    expect(delivery).toHaveTextContent('USD $1,000,000');
    expect(delivery).toHaveTextContent('Actual coverage: 144 of 150 mapped cost categories');
    expect(within(delivery).getByRole('link', { name: 'Review accounting mappings' }))
      .toHaveAttribute('href', '/administration/accounting#budget-account-map');
    expect(delivery).toHaveTextContent('Some portfolio values are unavailable');
    expect(delivery).toHaveTextContent('—');
  });

  it('AC-RD-UNAVAIL-001: an unknowable margin or amount is a dash with the reason, not prose in the figure slot', () => {
    dashState.data = {
      ...populated,
      pipeline_projected_margin: null as unknown as number,
      pipeline_weighted_value: null as unknown as number,
    };
    renderPage();
    const pipeline = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(pipeline).getByText('Pipeline forecast margin')).toBeInTheDocument();
    expect(within(pipeline).getByText('—')).toBeInTheDocument();
    expect(within(pipeline).queryByText('Not available yet')).toBeNull();
  });

  it('gives active contract value its own label distinct from contract value on hand', () => {
    renderPage();
    const delivery = screen.getByRole('region', { name: 'Delivery book' });
    expect(delivery).toHaveTextContent('Contract value on hand');
    expect(delivery).toHaveTextContent('Active contract value');
    expect(delivery).toHaveTextContent('$8,000,000');
  });

  it('a null pipeline margin from zero gross value shows no margin tile and the weighted card title (SL-B)', () => {
    dashState.data = { ...populated, pipeline_projected_margin: null, pipeline_total_value: 0 };
    renderPage();
    const pipeline = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(pipeline).getByText('Pipeline forecast margin')).toBeInTheDocument();
    expect(within(pipeline).getByText('—')).toBeInTheDocument();
  });

  it('AC-701 keeps active project count and exact contract value in the delivery book', () => {
    renderPage();
    expect(screen.getByRole('region', { name: 'Delivery book' })).toHaveTextContent('2 active projects');
    expect(screen.getByRole('region', { name: 'Delivery book' })).toHaveTextContent('$8,000,000');
  });

  it('AC-UX-016: approval decision appears before delivery evidence', () => {
    renderPage();
    const attention = screen.getByTestId('dashboard-attention');
    const delivery = screen.getByTestId('dashboard-delivery-book');
    expect(attention.compareDocumentPosition(delivery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(attention).getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/approvals');
  });
  it('AC-SL-A-001: nothing waiting → no approvals tile and no Review button on the executive dashboard', () => {
    approvalState.timesheets = [];
    try {
      renderPage();
      expect(screen.queryByRole('link', { name: 'Review requests' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Review at-risk projects' })).toHaveAttribute('href', '/projects?filter=at-risk');
    } finally {
      approvalState.timesheets = [{ id: 't1' }];
    }
  });
  it('pending approvals provide the primary Review requests action to /approvals', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/approvals');
  });
  it('budget-vs-actual region surfaces the active project count (AC-703)', () => {
    renderPage();
    expect(screen.getByRole('region', { name: 'Delivery book' })).toHaveTextContent('2 active projects');
  });
  it('AC-RF-007: purchasing chart states that ERP-native purchases are outside PMO scope', () => {
    renderPage();
    const disclosure = screen.getByText('Purchasing requests', { selector: 'summary' }).closest('details')!;
    expect(disclosure).toHaveTextContent('Draft');
    expect(disclosure).toHaveTextContent('Paid');
  });

  it('AC-S19-004: dashboard links use the shared full status labels and preserve raw status filters', () => {
    dashState.data = {
      ...populated,
      procurements_by_status: [
        ...populated.procurements_by_status,
        { status: 'Received', count: 1 },
        { status: 'Vendor Invoiced', count: 1 },
      ],
    };
    renderPage();
    const chart = screen.getByTestId('dashboard-purchasing');
    fireEvent.click(within(chart).getByText('Purchasing requests'));
    expect(within(chart).getByRole('link', { name: /Purchase Request/ })).toHaveAttribute(
      'href',
      '/procurement?status=Requested',
    );
    expect(within(chart).getByRole('link', { name: /Vendor Quote/ })).toHaveAttribute(
      'href',
      '/procurement?status=Vendor%20Quoted',
    );
    expect(within(chart).getByRole('link', { name: /Purchase Order/ })).toHaveAttribute(
      'href',
      '/procurement?status=Ordered',
    );
    expect(within(chart).getByRole('link', { name: /Goods Receipt/ })).toHaveAttribute(
      'href',
      '/procurement?status=Received',
    );
    expect(within(chart).getByRole('link', { name: /Vendor Invoice/ })).toHaveAttribute(
      'href',
      '/procurement?status=Vendor%20Invoiced',
    );
  });

  it('AC-S19-004: no PMO requests is clear while ERP-native purchasing stays in scope copy', () => {
    dashState.data = { ...populated, procurements_by_status: [] };
    renderPage();
    const chart = screen.getByTestId('dashboard-purchasing');
    fireEvent.click(within(chart).getByText('Purchasing requests'));
    expect(within(chart).getByText('No PMO requests to show')).toBeInTheDocument();
  });
  it('spending-vs-contract list shows project names and contract denominator', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getByText('Acme Internal Platform')).toBeInTheDocument();
  });
});

describe('ExecutiveDashboard states', () => {
  it('loading skeleton while pending (AC-706)', () => {
    dashState.isPending = true; dashState.isError = false;
    renderPage();
    expect(screen.getByTestId('dashboard-delivery-book')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-pipeline')).toBeInTheDocument();
    expect(screen.getAllByText(/Loading/i).length).toBeGreaterThan(0);
  });
  it('error state with retry (AC-707)', () => {
    dashState.isError = true; dashState.isPending = false;
    renderPage();
    expect(screen.getAllByText(/Couldn't load the dashboard/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
  it('empty state when org has no projects/procurements (AC-708)', () => {
    dashState.data = {
      active_projects: 0, total_contract_value: 0,
      on_hand_margin: 0, on_hand_value: 0, on_hand_contract_remaining: 0, on_hand_realized_margin: 0,
      on_hand_actual_known: 0, on_hand_actual_project_count: 0, on_hand_actual_project_total: 0,
      on_hand_actual_coverage_count: 0, on_hand_actual_coverage_total: 0,
      on_hand_value_by_currency: [], on_hand_realized_margin_by_currency: [],
      pipeline_weighted_value: 0, pipeline_projected_margin: 0, pipeline_total_value: 0, projects_at_risk: 0,
      projects_by_status: [], procurements_by_status: [], top_projects: [],
    };
    renderPage();
    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
  });
});

describe('ExecutiveDashboard design polish', () => {
  it('known risk is linked to its project filter', () => {
    approvalState.timesheets = [];
    renderPage();
    const warningLink = screen.getByRole('link', { name: 'Review at-risk projects' });
    expect(warningLink).toHaveAttribute('href', '/projects?filter=at-risk');
  });

  it('DA-3: mobile dashboard renders the Board pack action', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /board pack/i })).toBeInTheDocument();
  });
});

describe('ExecutiveDashboard dual-lens tiles (AC-1114 / FR-SPD-012)', () => {
  it('AC-1114: renders contracted revenue and billed-work margin without implying contract remainder is profit', () => {
    renderPage();
    const delivery = screen.getByRole('region', { name: 'Delivery book' });
    expect(delivery).toHaveTextContent('Contract remaining after known Actual');
    expect(delivery).toHaveTextContent('Margin on billed work');
    expect(delivery).not.toHaveTextContent('94.9%');
    const pipeline = screen.getByRole('region', { name: 'Pipeline' });
    expect(pipeline).toHaveTextContent('Pipeline forecast margin');
    expect(pipeline).toHaveTextContent('20.0%');
  });

  it('AC-IXD-DASH-002: the forecast-margin tile shows weightedPct only — no lens toggle', () => {
    renderPage();
    const pipeline = screen.getByRole('region', { name: 'Pipeline' });
    expect(pipeline).toHaveTextContent('20.0%');
    expect(screen.queryByRole('tab', { name: /Weighted/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /On-hand/i })).toBeNull();
  });
});

describe('ExecutiveDashboard win-rate widget (AC-1115 / FR-SPD-013)', () => {
  it('AC-1115: win-rate tile toggles count↔value and period re-queries (FR-SPD-013)', () => {
    resetWinRateRangeTracker();
    renderPage();
    expect(screen.getByTestId('win-rate-rate-count')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('win-rate-rate-USD')).toHaveTextContent('92.5%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('win-rate-rate-count')).toHaveTextContent('66.7%');

    const initialKey = winRateRangeTracker.current?.key;
    fireEvent.click(screen.getByTestId('win-rate-period-q'));
    expect(winRateRangeTracker.current?.key).not.toBe(initialKey);
  });
});

describe('ExecutiveDashboard Procurement-by-Status drill links (AC-JR-W1-10)', () => {
  it('AC-JR-W1-10: each procurement status legend entry links to /procurement?status=<Status>', () => {
    renderPage();
    fireEvent.click(screen.getByText('Purchasing requests'));
    // The populated oracle has 5 procurement statuses; each should now be a link.
    const draftLink = screen.getByRole('link', { name: /Draft/i });
    expect(draftLink).toHaveAttribute('href', '/procurement?status=Draft');

    const requestedLink = screen.getByRole('link', { name: /Purchase Request/i });
    expect(requestedLink).toHaveAttribute('href', '/procurement?status=Requested');

    const paidLink = screen.getByRole('link', { name: /Paid/i });
    expect(paidLink).toHaveAttribute('href', '/procurement?status=Paid');
  });

  it('AC-JR-W1-10: procurement status links use encodeURIComponent for statuses with spaces', () => {
    renderPage();
    fireEvent.click(screen.getByText('Purchasing requests'));
    // "Vendor Quote" has a space — the raw status value is still encoded unchanged.
    const vendorLink = screen.getByRole('link', { name: /Vendor Quote/i });
    expect(vendorLink).toHaveAttribute('href', '/procurement?status=Vendor%20Quoted');
  });
});

describe('ExecutiveDashboard noun fix: "opportunity value" → "project value" (AC-JR-W4-05)', () => {
  it('AC-JR-W4-05: Pipeline (weighted) help tooltip says "project value" not "opportunity value"', () => {
    renderPage();
    const measurement = screen.getByText('How figures are measured').closest('details');
    fireEvent.click(screen.getByText('How figures are measured'));
    expect(measurement).toHaveTextContent('Contract value for won, on-hold, delivery, and closed-out work');
    // Regression: old "opportunity value" text must not appear anywhere in the rendered page
    expect(document.body.textContent).not.toContain('opportunity value');
  });
});

describe('ExecutiveDashboard scope', () => {
  it('keeps the dashboard inside the portfolio scope and uses one primary action', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Executive Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Portfolio · delivery and sales evidence')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Review (requests|at-risk projects)/ })).toHaveLength(1);
  });
});

describe('coming_soon_clicked: the "Board pack" deferred export affordance (2026-07-13 wiring plan)', () => {
  beforeEach(() => {
    analytics.trackComingSoonClicked.mockClear();
  });

  it('AC: clicking the disabled Board pack affordance fires trackComingSoonClicked (demand signal)', () => {
    renderPage();
    const boardPack = screen.getByRole('button', { name: /board pack \(coming soon\)/i });
    expect(boardPack).toBeDisabled();
    // The wrapping span reports the click — a disabled button cannot dispatch one.
    fireEvent.click(boardPack.parentElement!);
    expect(analytics.trackComingSoonClicked).toHaveBeenCalledWith('board-pack-export', 'dashboard');
  });
});

describe('still to invoice (OD-BILL-1 / #786)', () => {
  it('AC-UNB-005 the executive dashboard carries the still-to-invoice card', () => {
    renderPage();
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();
  });
});
