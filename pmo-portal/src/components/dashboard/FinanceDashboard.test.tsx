import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { formatCurrency } from '@/src/lib/format';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import { FinanceDashboard } from './FinanceDashboard';
import { BahasaProvider } from '@/test/bahasa';

const collectionsIntegration = vi.hoisted(() => ({
  companies: [] as Array<{ id: string; name: string }>,
  arAging: [] as ErpAgingSnapshotRow[],
  customerLinks: new Map<string, string>(),
}));

const dash = {
  active_projects: 2, total_contract_value: 8_000_000, currency: 'USD',
  on_hand_margin: 0.25, on_hand_value: 6_000_000, on_hand_contract_remaining: 4_500_000,
  on_hand_realized_margin: 1_500_000, on_hand_actual_known: 4_000_000,
  on_hand_actual_project_count: 2, on_hand_actual_project_total: 2,
  on_hand_actual_coverage_count: 2, on_hand_actual_coverage_total: 2,
  pipeline_weighted_value: 800_000, pipeline_projected_margin: 0.2, pipeline_total_value: 2_000_000,
  projects_at_risk: 1,
  projects_by_status: [], procurements_by_status: [{ status: 'Paid', count: 2 }, { status: 'Vendor Invoiced', count: 1 }],
  top_projects: [
    { id: 'p1', name: 'Alpha', client_name: 'Acme', contract_value: 5_000_000, currency: 'USD', budget: 4_000_000, spent: 3_000_000, status: 'Ongoing Project' },
    { id: 'p2', name: 'Beta', client_name: 'Beta Co', contract_value: 3_000_000, currency: 'USD', budget: 2_000_000, spent: 1_000_000, status: 'Ongoing Project' },
  ],
};

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();

const procurements = [
  // pr1: real vendor_invoiced_at ~10 days old; updated_at today (proxy would read 0 — proves the column wins).
  { id: 'pr1', status: 'Vendor Invoiced', total_value: 250_000, currency: 'USD', vendor_invoiced_at: iso(10), updated_at: iso(0) },
  // pr2: null vendor_invoiced_at (legacy/edge) → falls back to updated_at ~3 days old.
  { id: 'pr2', status: 'Vendor Invoiced', total_value: 150_000, currency: 'USD', vendor_invoiced_at: null, updated_at: iso(3) },
  { id: 'pr3', status: 'Paid', total_value: 999_999, currency: 'USD', vendor_invoiced_at: null, updated_at: iso(0) },
];

// N17 budget review now comes from the get_finance_budget_review RPC (committed basis, ranked).
// Provide 6 ranked-by-variance rows so the FE top-5 slice is observable (Rank6 must NOT render).
const budgetReviewRow = (input: {
  id: string; name: string; client_name: string; budget: number; spent: number; variance: number;
}) => ({
  status: 'Ongoing Project', currency: 'USD', budget_currency: 'USD', actual_currency: 'USD',
  actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1,
  actual_as_of: '2026-10-17T12:00:00Z',
  ...input,
});
const budgetReview = [
  budgetReviewRow({ id: 'b1', name: 'Rank1', client_name: 'C1', budget: 1_000_000, spent: 1_500_000, variance: 500_000 }),
  budgetReviewRow({ id: 'b2', name: 'Rank2', client_name: 'C2', budget: 1_000_000, spent: 1_400_000, variance: 400_000 }),
  budgetReviewRow({ id: 'b3', name: 'Rank3', client_name: 'C3', budget: 1_000_000, spent: 1_300_000, variance: 300_000 }),
  budgetReviewRow({ id: 'b4', name: 'Rank4', client_name: 'C4', budget: 1_000_000, spent: 1_200_000, variance: 200_000 }),
  budgetReviewRow({ id: 'b5', name: 'Rank5', client_name: 'C5', budget: 1_000_000, spent: 1_100_000, variance: 100_000 }),
  budgetReviewRow({ id: 'b6', name: 'Rank6', client_name: 'C6', budget: 1_000_000, spent: 1_050_000, variance: 50_000 }),
];

// OD-BILL-1: the Still-to-invoice card reads through react-query; stubbed like the other dashboard hooks.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dash, isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: budgetReview, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'project-17', name: 'Synthetic Project' }] }), useProjectIdentity: () => ({ data: [{ id: 'project-17', name: 'Synthetic Project' }] }) }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: collectionsIntegration.companies, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: () => ({ customerLinks: collectionsIntegration.customerLinks }),
}));
// task FIX-2 (Discover CRITICAL 2): empty by default (the unflipped-org state) — the dedicated
// AccountingSnapshotsSection.test.tsx owns the populated/loading/error render assertions.
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: collectionsIntegration.arAging, isPending: false, isError: false, refetch: vi.fn() }),
}));
// N15 approvals tile reads the real role + timesheet queue.
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance' }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
}));
// FR-L10N-020: dashboard aggregates are org-denominated (the RPC rows carry no currency of their
// own), so the component reads useOrgCurrency and the test pins it rather than leaving it to a real
// query. ⚑ This mock sits at line-start on purpose — an earlier automated insert landed it INSIDE
// the vi.mock call below, which parses as a syntax error rather than a wrong value.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'fin-1', org_id: 'org-1' }, role: 'Finance' }),
}));

const renderPane = () => render(<MemoryRouter><FinanceDashboard /></MemoryRouter>);

beforeEach(() => {
  procurements[0]!.total_value = 250_000;
  procurements[1]!.total_value = 150_000;
  dash.on_hand_actual_project_count = 2;
  dash.on_hand_actual_project_total = 2;
  dash.on_hand_actual_coverage_count = 2;
  dash.on_hand_actual_coverage_total = 2;
  collectionsIntegration.companies = [];
  collectionsIntegration.arAging = [];
  collectionsIntegration.customerLinks.clear();
});

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
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/approvals');
    // procurements fixture has NO Requested rows → 0 awaiting (Finance can approve but none pending)
    expect(tile).toHaveTextContent('0');
  });
});

describe('FinanceDashboard (real — exec RPC + procurements)', () => {
  it('shows contract value in progress, distinct from the on-hand contract value', () => {
    renderPane();
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('$8,000,000');
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('Contract value in progress');
  });

  it('labels PMO purchasing scope and explains an empty request chart', () => {
    const previous = procurements.splice(0);
    renderPane();
    expect(screen.getByText('PMO purchasing requests')).toBeInTheDocument();
    expect(screen.getByText('ERP-native purchases are outside this PMO request chart.')).toBeInTheDocument();
    expect(screen.getByText('No procurement activity yet')).toBeInTheDocument();
    procurements.push(...previous);
  });
  it('AC-RD-SPEND-001: calls an incomplete portfolio sum recorded spending and marks it partial', () => {
    dash.on_hand_actual_project_count = 2;
    dash.on_hand_actual_project_total = 3;
    dash.on_hand_actual_coverage_count = 4;
    dash.on_hand_actual_coverage_total = 5;
    renderPane();
    expect(screen.getByTestId('kpi-spend')).toHaveTextContent('Recorded spending');
    expect(screen.getByTestId('kpi-spend')).toHaveTextContent('Partial');
  });
  it('AC-UX-014: shows portfolio Actual from the complete dashboard read, not only top-project rows', () => {
    renderPane();
    // OD-MONEY-FMT: short figure on the card, exact amount in title + sr text.
    expect(screen.getByTestId('kpi-spend')).toHaveTextContent('$4.0M');
    expect(screen.getByTestId('kpi-spend').querySelector('[title="$4,000,000"]')).not.toBeNull();
  });
  it('does not treat a missing vendor invoice amount as zero', () => {
    procurements[0]!.total_value = null as unknown as number;
    renderPane();
    expect(screen.getByTestId('kpi-outstanding')).toHaveTextContent('Not available yet');
    expect(screen.getByTestId('kpi-outstanding')).not.toHaveTextContent('$150,000');
  });
  it('AC-RD-FIN-003: localizes finance money labels and names vendor balances as payables in Bahasa', () => {
    render(<BahasaProvider locale="id"><MemoryRouter><FinanceDashboard /></MemoryRouter></BahasaProvider>);
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('Nilai kontrak berjalan');
    expect(screen.getByTestId('kpi-spend')).toHaveTextContent('Pengeluaran tercatat');
    expect(screen.getByTestId('kpi-outstanding')).toHaveTextContent('Utang kepada vendor');
    expect(screen.queryByText('Outstanding invoices')).not.toBeInTheDocument();
    expect(screen.queryByText('Total project spend')).not.toBeInTheDocument();
    expect(screen.getByText('Aktual (buku besar ERP)')).toBeInTheDocument();
    expect(screen.getByText('Utang kepada vendor (AP)')).toBeInTheDocument();
    const rendered = document.body.textContent ?? '';
    for (const englishLabel of ['PRs awaiting you', 'Total project spend', 'Outstanding invoices', 'vendor-invoiced, awaiting payment', 'Ready to pay', 'Actuals (ERP ledger)', 'AP aging', 'Fiscal year', 'Total outstanding']) {
      expect(rendered).not.toContain(englishLabel);
    }
  });
  it('shows billed-work margin separately from contract remaining', () => {
    renderPane();
    expect(screen.getByTestId('kpi-margin')).toHaveTextContent('$1.5M');
    expect(screen.getByTestId('kpi-margin').querySelector('[title="$1,500,000"]')).not.toBeNull();
    expect(screen.getByTestId('kpi-margin')).toHaveTextContent('Margin to date');
    expect(screen.getByTestId('kpi-margin')).toHaveTextContent('Contract remaining after known Actual: $4.5M');
  });
  it('computes outstanding invoices as Σ value of Vendor Invoiced procurements (real, not 0.4 fabrication)', () => {
    renderPane();
    // 250k + 150k = 400k; the Paid one is excluded
    expect(screen.getByTestId('kpi-outstanding')).toHaveTextContent(formatCurrency(400_000, 'USD'));
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

  it('opens the named project budget directly from the budget exception', () => {
    renderPane();
    const link = screen.getByRole('link', { name: 'Review Rank1 budget' });
    expect(link).toHaveAttribute('href', '/projects/b1/budget');
  });
});

describe('FinanceDashboard task FIX-2 (Discover CRITICAL 2) — accounting snapshots mounted', () => {
  it('mounts the read-only actuals/AP-AR aging snapshot section, empty by default', () => {
    renderPane();
    expect(screen.getByRole('region', { name: 'Accounting snapshots' })).toBeInTheDocument();
    expect(screen.getByText('No actuals snapshot yet')).toBeInTheDocument();
    expect(screen.getAllByText('No aging data to show yet.')).toHaveLength(2);
    expect(screen.getAllByText(/Ask your administrator to sync accounting data/i)).toHaveLength(3);
  });

  it('AC-S36-002: links canonical Customer IDs to their exact company collections page', () => {
    const agingRow: ErpAgingSnapshotRow = {
      party: 'Customer:C-0001', partyType: 'Customer', currency: 'USD', totalOutstanding: 250,
      current: 0, bucket0to30: 250, bucket31to60: 0, bucket61to90: 0, bucketOver90: 0,
      rangeLabels: { b_0_30: '0–30 days' }, reportDate: '2026-10-18', ageingBasedOn: 'Due Date',
      asOf: '2026-10-18T00:00:00Z', sourceReport: 'Accounts Receivable', reportVersion: '15', snapshotId: 'snapshot-1',
    };
    collectionsIntegration.companies = [{ id: 'co-client-1', name: 'Meridian Display Name' }];
    collectionsIntegration.arAging = [agingRow];
    collectionsIntegration.customerLinks.set('Customer:C-0001', 'co-client-1');

    renderPane();

    expect(screen.getByText('Customer collections (AR)', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customer:C-0001' })).toHaveAttribute(
      'href', '/companies/co-client-1#collections',
    );
    expect(screen.queryByText('Meridian Display Name')).not.toBeInTheDocument();
  });
});

describe('still to invoice (OD-BILL-1 / #786)', () => {
  it('AC-UNB-005 the finance dashboard carries the still-to-invoice card', () => {
    renderPane();
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();
  });
});
