/**
 * S1 Wave-0 — Mobile executive dashboard regression tests.
 *
 * Verifies the mobile (<768px, useIsDesktop()=false) variant:
 * - AC-MOBILE-1: At-risk block renders BEFORE charts/pipeline below fold.
 * - AC-MOBILE-2: Approvals band with primary "Review" CTA renders before charts.
 * - AC-MOBILE-3: Contract book (Revenue on hand + Active contract value) renders before charts.
 * - AC-MOBILE-4: B-MIN-3 source-lines present in Contract book.
 * - AC-MOBILE-5: "Active contract value" relabel in place of "Total contract value" on mobile.
 * - AC-MOBILE-6: Desktop layout still renders full KPI band (6 tiles) with "Total contract value".
 *
 * Ordering is asserted by DOM order (compareDocumentPosition).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

// ── Data fixtures ─────────────────────────────────────────────────────────────
const populated = {
  active_projects: 18,
  total_contract_value: 23050000,
  on_hand_margin: 0.224,
  on_hand_value: 26650000,
  pipeline_weighted_value: 8400000,
  pipeline_projected_margin: 0.315,
  pipeline_total_value: 19200000,
  projects_at_risk: 3,
  projects_by_status: [{ status: 'Ongoing Project', count: 18 }],
  procurements_by_status: [
    { status: 'Draft', count: 1 },
    { status: 'Requested', count: 2 },
  ],
  top_projects: [
    {
      id: 'p1', name: 'Alpha Project', client_name: 'ACME',
      contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project',
    },
  ],
};

const winRateOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8000000, losses_value: 650000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
};

// ── Module mocks ──────────────────────────────────────────────────────────────
const dashState: {
  data: typeof populated | null;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: populated, isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => dashState,
  useWinRate: () => ({ data: winRateOracle, isPending: false, isError: false }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: [
      { id: 'pr1', status: 'Requested', requested_by_id: 'other-1' },
      { id: 'pr2', status: 'Requested', requested_by_id: 'other-2' },
    ],
    isPending: false,
  }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({
    data: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

// ── useIsDesktop mock control ─────────────────────────────────────────────────
let mockIsDesktop = false;

vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => mockIsDesktop,
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
  dashState.data = populated;
  dashState.isPending = false;
  dashState.isError = false;
  mockIsDesktop = false;
});

// ── Helper: get DOM order of two elements (negative = el1 before el2) ─────────
function domOrderCompare(el1: HTMLElement, el2: HTMLElement): number {
  const pos = el1.compareDocumentPosition(el2);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // el2 after el1 → el1 first
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;  // el2 before el1 → el1 last
  return 0;
}

// ────────────────────────────────────────────────────────────────────────────────
describe('AC-MOBILE-1/2/3: mobile above-the-fold order', () => {
  it('AC-MOBILE-1: at-risk block renders before charts section', () => {
    mockIsDesktop = false;
    renderPage();
    const atRisk = screen.getByTestId('dashboard-at-risk');
    // Charts section (budget vs actual or procurement)
    const charts = screen.getByTestId('dashboard-pipeline');
    expect(domOrderCompare(atRisk, charts)).toBe(-1); // at-risk before charts
  });

  it('AC-MOBILE-2: approvals band with Review CTA renders before charts', () => {
    mockIsDesktop = false;
    renderPage();
    // The entire approvals band is a single link to /approvals.
    // The "Review" label is visible text within it (One Blue Rule: the only primary CTA above fold).
    const approvalsBand = screen.getByTestId('mobile-approvals-band');
    // The band itself is the <a> link
    expect(approvalsBand.tagName.toLowerCase()).toBe('a');
    expect(approvalsBand).toHaveAttribute('href', '/approvals');
    // "Review" text is inside the band
    expect(approvalsBand).toHaveTextContent(/Review/i);
    const charts = screen.getByTestId('dashboard-pipeline');
    expect(domOrderCompare(approvalsBand, charts)).toBe(-1);
  });

  it('AC-MOBILE-3: contract book section (Revenue on hand + Active contract value) renders before charts', () => {
    mockIsDesktop = false;
    renderPage();
    const contractBook = screen.getByTestId('mobile-contract-book');
    const charts = screen.getByTestId('dashboard-pipeline');
    expect(domOrderCompare(contractBook, charts)).toBe(-1);
    // Both money tiles present inside the contract book
    expect(within(contractBook).getByTestId('mobile-kpi-on-hand')).toBeInTheDocument();
    expect(within(contractBook).getByTestId('mobile-kpi-active-contract-value')).toBeInTheDocument();
  });

  it('AC-MOBILE-4: B-MIN-3 source-lines are present in the contract book', () => {
    mockIsDesktop = false;
    renderPage();
    const contractBook = screen.getByTestId('mobile-contract-book');
    expect(within(contractBook).getByText(/Booked across active \+ closed-out contracts/i)).toBeInTheDocument();
    expect(within(contractBook).getByText(/Signed value of/i)).toBeInTheDocument();
    expect(within(contractBook).getByText(/projects still in delivery/i)).toBeInTheDocument();
  });

  it('AC-MOBILE-5: "Active contract value" label replaces "Total contract value" in mobile contract book', () => {
    mockIsDesktop = false;
    renderPage();
    const contractBook = screen.getByTestId('mobile-contract-book');
    expect(within(contractBook).getByText(/Active contract value/i)).toBeInTheDocument();
    // "Total contract value" should NOT appear inside the mobile contract book
    expect(within(contractBook).queryByText(/^Total contract value$/i)).not.toBeInTheDocument();
  });

  it('at-risk block shows projects_at_risk count with warning tone', () => {
    mockIsDesktop = false;
    renderPage();
    const atRisk = screen.getByTestId('dashboard-at-risk');
    expect(atRisk).toHaveTextContent('3');
    expect(atRisk).toHaveTextContent(/at.risk/i);
  });

  it('at-risk block contains drill cells for active projects and spend', () => {
    mockIsDesktop = false;
    renderPage();
    const atRisk = screen.getByTestId('dashboard-at-risk');
    // Two drill cells: one for active projects, one for spend
    const links = within(atRisk).getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AC-MOBILE-6: desktop layout unaffected', () => {
  it('desktop renders the full 6-tile KPI band including "Total contract value"', () => {
    mockIsDesktop = true;
    renderPage();
    // All 6 existing KPI tiles must be present on desktop
    expect(screen.getByTestId('kpi-on-hand-margin')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-pipeline-weighted-value')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-pipeline-projected-margin')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-active-projects')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-contract-value')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-spend')).toBeInTheDocument();
    // Standard approvals tile (KPITile variant), not the mobile band
    expect(screen.getByTestId('kpi-awaiting-approval')).toBeInTheDocument();
    // Mobile-specific sections should NOT be in DOM on desktop
    expect(screen.queryByTestId('dashboard-at-risk')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-approvals-band')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-contract-book')).not.toBeInTheDocument();
  });
});

describe('AC-MOBILE edge: zero at-risk', () => {
  it('at-risk block shows 0 with neutral/success tone, not warning', () => {
    dashState.data = { ...populated, projects_at_risk: 0 };
    mockIsDesktop = false;
    renderPage();
    const atRisk = screen.getByTestId('dashboard-at-risk');
    expect(atRisk).toHaveTextContent('0');
    // The 0-risk variant should show positive/neutral copy, not "at-risk" in warning
    expect(atRisk).toHaveTextContent(/all on track/i);
  });
});

describe('AC-MOBILE loading/error states', () => {
  it('loading state renders skeletons on mobile', () => {
    dashState.isPending = true;
    dashState.data = null;
    mockIsDesktop = false;
    renderPage();
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
  });

  it('error state renders on mobile', () => {
    dashState.isError = true;
    dashState.isPending = false;
    dashState.data = null;
    mockIsDesktop = false;
    renderPage();
    expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
  });
});
