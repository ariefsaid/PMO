import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatCurrency } from '@/src/lib/format';
import { FinanceDashboard } from './FinanceDashboard';

const dash = {
  active_projects: 2, total_contract_value: 8_000_000,
  on_hand_margin: 0.25, on_hand_value: 6_000_000,
  pipeline_weighted_value: 800_000, pipeline_projected_margin: 0.2, pipeline_total_value: 2_000_000,
  projects_at_risk: 1,
  projects_by_status: [], procurements_by_status: [{ status: 'Paid', count: 2 }, { status: 'Vendor Invoiced', count: 1 }],
  top_projects: [
    { id: 'p1', name: 'Alpha', client_name: 'Acme', contract_value: 5_000_000, budget: 4_000_000, spent: 3_000_000, status: 'Ongoing Project' },
    { id: 'p2', name: 'Beta', client_name: 'Beta Co', contract_value: 3_000_000, budget: 2_000_000, spent: 1_000_000, status: 'Ongoing Project' },
  ],
};

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();

const procurements = [
  // pr1: real vendor_invoiced_at ~10 days old; updated_at today (proxy would read 0 — proves the column wins).
  { id: 'pr1', status: 'Vendor Invoiced', total_value: 250_000, vendor_invoiced_at: iso(10), updated_at: iso(0) },
  // pr2: null vendor_invoiced_at (legacy/edge) → falls back to updated_at ~3 days old.
  { id: 'pr2', status: 'Vendor Invoiced', total_value: 150_000, vendor_invoiced_at: null, updated_at: iso(3) },
  { id: 'pr3', status: 'Paid', total_value: 999_999, vendor_invoiced_at: null, updated_at: iso(0) },
];

// N17 budget review now comes from the get_finance_budget_review RPC (committed basis, ranked).
// Provide 6 ranked-by-variance rows so the FE top-5 slice is observable (Rank6 must NOT render).
const budgetReview = [
  { id: 'b1', name: 'Rank1', client_name: 'C1', budget: 1_000_000, spent: 1_500_000, variance: 500_000 },
  { id: 'b2', name: 'Rank2', client_name: 'C2', budget: 1_000_000, spent: 1_400_000, variance: 400_000 },
  { id: 'b3', name: 'Rank3', client_name: 'C3', budget: 1_000_000, spent: 1_300_000, variance: 300_000 },
  { id: 'b4', name: 'Rank4', client_name: 'C4', budget: 1_000_000, spent: 1_200_000, variance: 200_000 },
  { id: 'b5', name: 'Rank5', client_name: 'C5', budget: 1_000_000, spent: 1_100_000, variance: 100_000 },
  { id: 'b6', name: 'Rank6', client_name: 'C6', budget: 1_000_000, spent: 1_050_000, variance: 50_000 },
];

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dash, isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: budgetReview, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, isPending: false, isError: false, refetch: vi.fn() }),
}));
// task FIX-2 (Discover CRITICAL 2): empty by default (the unflipped-org state) — the dedicated
// AccountingSnapshotsSection.test.tsx owns the populated/loading/error render assertions.
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// N15 approvals tile reads the real role + timesheet queue.
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance' }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'fin-1', org_id: 'org-1' }, role: 'Finance' }),
}));

const renderPane = () => render(<MemoryRouter><FinanceDashboard /></MemoryRouter>);

describe('FinanceDashboard KPI grid — monotonic arbitrary breakpoints (C1)', () => {
  it('KPI band uses only arbitrary min-[] variants — no named sm: mixed in', () => {
    const { container } = renderPane();
    const band = container.querySelector('[aria-label="Finance KPIs"]') as HTMLElement;
    expect(band.className).toContain('min-[560px]:grid-cols-2');
    // 5 tiles now (4 finance KPIs + the N15 approvals shortcut) → 5-col at the widest tier.
    expect(band.className).toContain('min-[1180px]:grid-cols-5');
    expect(band.className).not.toContain('sm:grid-cols');
  });
});

describe('FinanceDashboard N15 — PRs-only approvals shortcut', () => {
  it('renders an approvals tile linking to /approvals (Finance has no timesheet approval)', () => {
    renderPane();
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveAttribute('href', '/approvals');
    // procurements fixture has NO Requested rows → 0 awaiting (Finance can approve but none pending)
    expect(tile).toHaveTextContent('0');
  });
});

describe('FinanceDashboard (real — exec RPC + procurements)', () => {
  it('shows total contracted revenue from the RPC', () => {
    renderPane();
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('$8,000,000');
  });
  it('shows total project spend (Σ top_projects.spent)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-spend')).toHaveTextContent(formatCurrency(4_000_000));
  });
  it('shows on-hand margin', () => {
    renderPane();
    expect(screen.getByTestId('kpi-margin')).toHaveTextContent('25.0%');
  });
  it('computes outstanding invoices as Σ value of Vendor Invoiced procurements (real, not 0.4 fabrication)', () => {
    renderPane();
    // 250k + 150k = 400k; the Paid one is excluded
    expect(screen.getByTestId('kpi-outstanding')).toHaveTextContent(formatCurrency(400_000));
  });
});

describe('FinanceDashboard N16 — invoice age from vendor_invoiced_at', () => {
  // AC-FIN-DEBT-005: age column reads vendor_invoiced_at when present, header is invoice age.
  it('AC-FIN-DEBT-005: Ready-to-pay age column shows age from vendor_invoiced_at, header is invoice age', () => {
    renderPane();
    // pr1.vendor_invoiced_at ≈ 10 days ago ⇒ "10 days" (NOT updated_at=today which would read "Today").
    expect(screen.getByText('10 days')).toBeInTheDocument();
    // Header no longer reads the misleading "Last updated" proxy; it reads as invoice age.
    expect(screen.queryByText('Last updated')).not.toBeInTheDocument();
    // The N16 age-column header is exactly "Invoiced" (the honest invoice-age label).
    expect(screen.getByText('Invoiced', { exact: true })).toBeInTheDocument();
  });
  // AC-FIN-DEBT-006: null vendor_invoiced_at falls back to updated_at without error.
  it('AC-FIN-DEBT-006: null vendor_invoiced_at falls back to updated_at', () => {
    renderPane();
    // pr2.vendor_invoiced_at null, updated_at ≈ 3 days ago ⇒ "3 days".
    expect(screen.getByText('3 days')).toBeInTheDocument();
  });
});

describe('FinanceDashboard N17 — budget review from get_finance_budget_review RPC', () => {
  // AC-FIN-DEBT-013: card renders RPC rows (NOT an FE re-sort of top_projects), top-5 slice, honest label.
  it('AC-FIN-DEBT-013: Budget review shows top-5 RPC rows, honest portfolio-wide label', () => {
    renderPane();
    // RPC supplies 6 rows; the card shows 5 (FE slice). The 6th-ranked project must NOT render.
    expect(screen.queryByText('Rank6')).not.toBeInTheDocument();
    expect(screen.getByText('Rank1')).toBeInTheDocument();
    expect(screen.getByText('Rank5')).toBeInTheDocument();
    // It must read the RPC, not top_projects (whose names were Alpha/Beta).
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    // Honest portfolio-wide label.
    expect(screen.getByText(/budget review/i)).toBeInTheDocument();
    expect(screen.getByText(/portfolio-wide/i)).toBeInTheDocument();
  });
});

describe('FinanceDashboard task FIX-2 (Discover CRITICAL 2) — accounting snapshots mounted', () => {
  it('mounts the read-only actuals/AP-AR aging snapshot section, empty by default', () => {
    renderPane();
    expect(screen.getByRole('region', { name: 'Accounting snapshots' })).toBeInTheDocument();
    expect(screen.getByText('No actuals snapshot yet')).toBeInTheDocument();
    expect(screen.getByText('No AP aging snapshot yet')).toBeInTheDocument();
    expect(screen.getByText('No AR aging snapshot yet')).toBeInTheDocument();
  });
});
