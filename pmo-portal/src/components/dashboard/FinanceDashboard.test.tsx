import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
const unbilledState = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: true,
  isError: false,
}));
const dashboardRead = vi.hoisted(() => ({ isPending: false, isError: false }));
const procurementRead = vi.hoisted(() => ({ isPending: false, isError: false }));

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

const procurements: Array<Record<string, unknown>> = [
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
  useUnbilledWorkOrders: () => ({ ...unbilledState, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dash, ...dashboardRead, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: budgetReview, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, ...procurementRead, refetch: vi.fn() }),
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
  procurements.splice(0, procurements.length,
    { id: 'pr1', status: 'Vendor Invoiced', total_value: 250_000, currency: 'USD', vendor_invoiced_at: iso(10), updated_at: iso(0) },
    { id: 'pr2', status: 'Vendor Invoiced', total_value: 150_000, currency: 'USD', vendor_invoiced_at: null, updated_at: iso(3) },
    { id: 'pr3', status: 'Paid', total_value: 999_999, currency: 'USD', vendor_invoiced_at: null, updated_at: iso(0) },
  );
  dash.on_hand_actual_project_count = 2;
  dash.on_hand_actual_project_total = 2;
  dash.on_hand_actual_coverage_count = 2;
  dash.on_hand_actual_coverage_total = 2;
  collectionsIntegration.companies = [];
  collectionsIntegration.arAging = [];
  collectionsIntegration.customerLinks.clear();
  procurements.splice(3);
  unbilledState.data = undefined;
  unbilledState.isPending = true;
  unbilledState.isError = false;
  dashboardRead.isPending = false;
  dashboardRead.isError = false;
  procurementRead.isPending = false;
  procurementRead.isError = false;
});

describe('FinanceDashboard N15 — PRs-only approvals shortcut', () => {
  it('AC-SL-A-001: no approvals tile when nothing awaits Finance (fixture has no Requested rows)', () => {
    renderPane();
    expect(screen.queryByTestId('kpi-awaiting-approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
  });
});

describe('FinanceDashboard (real — exec RPC + procurements)', () => {
  it('shows contract value in progress, distinct from the on-hand contract value', () => {
    renderPane();
    expect(screen.getByText('Contract in progress')).toBeInTheDocument();
    expect(screen.getByText('$8,000,000')).toBeInTheDocument();
  });

  it('labels PMO purchasing scope and explains an empty request chart', () => {
    const previous = procurements.splice(0);
    try {
      renderPane();
      expect(screen.getByText('Purchasing requests')).toBeInTheDocument();
      expect(screen.getByText('ERP-native purchases are outside this PMO request chart.')).toBeInTheDocument();
      expect(screen.getByText('No procurement activity yet')).toBeInTheDocument();
    } finally {
      procurements.push(...previous);
    }
  });
  it('AC-RD-SPEND-001: calls an incomplete portfolio sum recorded spending and marks it partial', () => {
    dash.on_hand_actual_project_count = 2;
    dash.on_hand_actual_project_total = 3;
    dash.on_hand_actual_coverage_count = 4;
    dash.on_hand_actual_coverage_total = 5;
    renderPane();
    expect(screen.getByText('Known spending')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
  });
  it('AC-UX-014: shows portfolio Actual from the complete dashboard read, not only top-project rows', () => {
    renderPane();
    expect(screen.getByText('$4,000,000')).toBeInTheDocument();
  });
  it('does not treat a missing vendor invoice amount as zero', () => {
    procurements[0]!.total_value = null as unknown as number;
    renderPane();
    expect(screen.getByTestId('ready-to-pay-total')).toHaveTextContent('—');
    expect(screen.getByTestId('ready-to-pay-total')).not.toHaveTextContent('$150,000');
    expect(screen.queryByTestId('kpi-outstanding')).not.toBeInTheDocument();
  });
  it('AC-RD-FIN-003: localizes finance money labels and names vendor balances as payables in Bahasa', () => {
    render(<BahasaProvider locale="id"><MemoryRouter><FinanceDashboard /></MemoryRouter></BahasaProvider>);
    expect(screen.getByText('Kontrak berjalan')).toBeInTheDocument();
    expect(screen.getByText('Pengeluaran yang diketahui')).toBeInTheDocument();
    expect(screen.getAllByText(/Utang kepada vendor/).length).toBeGreaterThan(0);
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
    expect(screen.getByText('Margin on billed work')).toBeInTheDocument();
    expect(screen.getAllByText('$1,500,000')).toHaveLength(2);
    expect(screen.getByText('Contract remaining after known Actual')).toBeInTheDocument();
    expect(screen.getByText('$4,500,000')).toBeInTheDocument();
  });
  it('computes vendor payables by currency once in Ready to pay and does not repeat it as a summary tile', () => {
    renderPane();
    expect(screen.getByTestId('ready-to-pay-total')).toHaveTextContent(formatCurrency(400_000, 'USD'));
    expect(screen.queryByTestId('kpi-outstanding')).not.toBeInTheDocument();
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
    expect(screen.getByText('Invoiced age', { exact: true })).toBeInTheDocument();
  });
  // AC-FIN-DEBT-006: null vendor_invoiced_at falls back to updated_at without error.
  it('AC-FIN-DEBT-006: null vendor_invoiced_at falls back to updated_at', () => {
    renderPane();
    // pr2.vendor_invoiced_at null, updated_at ≈ 3 days ago ⇒ "3 days".
    expect(screen.getByText('3 days')).toBeInTheDocument();
  });
});

describe('FinanceDashboard N17 — budget review from get_finance_budget_review RPC', () => {
  // AC-FIN-DEBT-013: card renders RPC rows (NOT an FE re-sort of top_projects), top-5 slice.
  it('AC-FIN-DEBT-013: Budget review shows five rows from the portfolio ranking', () => {
    renderPane();
    // RPC supplies 6 rows; the card shows 5 (FE slice). The 6th-ranked project must NOT render.
    expect(screen.queryByText('Rank6')).not.toBeInTheDocument();
    expect(screen.getByText('Rank1')).toBeInTheDocument();
    expect(screen.getByText('Rank5')).toBeInTheDocument();
    // It must read the RPC, not top_projects (whose names were Alpha/Beta).
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Budget review')).toBeInTheDocument();
    expect(screen.getByText('Five projects by budget variance')).toBeInTheDocument();
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
    screen.getByText('Financial position and accounting evidence').click();
    expect(screen.getByRole('region', { name: 'Accounting snapshots' })).toBeInTheDocument();
    expect(screen.getByText('No actuals snapshot yet')).toBeInTheDocument();
    expect(screen.getAllByText('No aging data to show yet.')).toHaveLength(2);
    expect(screen.getAllByText(/Ask your administrator to sync accounting data/i)).toHaveLength(1);
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

    expect(screen.getByText('Customer collections', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customer:C-0001' })).toHaveAttribute(
      'href', '/companies/co-client-1#collections',
    );
    expect(screen.queryByText('Meridian Display Name')).not.toBeInTheDocument();
  });
});

describe('Finance dashboard composition and next case', () => {
  it('AC-806-FIN-ORDER-001 puts billing/payment work before collections, budget and accounting details', () => {
    const { container } = renderPane();
    const headings = Array.from(container.querySelectorAll('h2')).map((heading) => heading.textContent?.trim());
    const relevant = headings.filter((heading) => [
      'Still to invoice on work orders', 'Ready to pay', 'Customer collections', 'Budget review',
    ].includes(heading ?? ''));
    expect(relevant).toEqual(['Still to invoice on work orders', 'Ready to pay', 'Customer collections', 'Budget review']);
    expect(screen.getByText('Five projects by budget variance')).toBeInTheDocument();
    expect(screen.getByText('Financial position and accounting evidence')).toBeInTheDocument();
    expect(screen.getByText('Purchasing requests')).toBeInTheDocument();
  });

  it('AC-806-FIN-NEXT-001 promotes the first invoiceable work order when no decision is pending', () => {
    unbilledState.data = {
      totals: [{ currency: 'USD', remaining: 120_000, count: 1 }], incompleteCount: 0,
      rows: [{ workOrderId: 'wo-1', woNumber: 'WO-001', title: 'Design package', projectId: 'project-1', projectName: 'Atlas', status: 'Closed', currency: 'USD', remaining: 120_000, daysSinceClosed: 4, clientPoNumber: null }],
      incomplete: [],
    };
    unbilledState.isPending = false;
    renderPane();
    expect(screen.getByRole('link', { name: 'Review work order' })).toHaveAttribute(
      'href', '/projects/project-1/work-orders?wo=wo-1',
    );
    expect(screen.queryByRole('link', { name: 'Review payable request' })).not.toBeInTheDocument();
  });

  it('AC-806-FIN-NEXT-002 gives pending decisions precedence over invoiceable work', () => {
    unbilledState.data = {
      totals: [], incompleteCount: 0, rows: [], incomplete: [],
    };
    unbilledState.isPending = false;
    procurements.push({
      ...procurements[0]!, id: 'pr-pending', status: 'Requested', title: 'Pending request',
      requested_by_id: 'someone-else', approvalRoute: { procurementId: 'pr-pending', route: 'flat', reason: 'no_project', approvers: [], requestAmount: 10, lineBudget: null, lineUsed: null },
    });
    renderPane();
    expect(screen.getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/approvals');
  });

  it('AC-806-FIN-NEXT-003 selects the oldest mapped overdue customer after billing and payable cases', () => {
    procurements.splice(0);
    unbilledState.data = { totals: [], incompleteCount: 0, rows: [], incomplete: [] };
    unbilledState.isPending = false;
    const customerAging = (party: string, bucket0to30: number, bucket61to90: number): ErpAgingSnapshotRow => ({
      party, partyType: 'Customer', currency: 'USD', totalOutstanding: bucket0to30 + bucket61to90,
      current: 0, bucket0to30, bucket31to60: 0, bucket61to90, bucketOver90: 0,
      rangeLabels: null, reportDate: '2026-10-20', ageingBasedOn: 'Due Date',
      asOf: '2026-10-20T00:00:00Z', sourceReport: 'Accounts Receivable', reportVersion: '15', snapshotId: 'snapshot-1',
    });
    collectionsIntegration.arAging = [customerAging('Customer:current', 0, 0), customerAging('Customer:young', 999, 0), customerAging('Customer:oldest', 0, 50)];
    collectionsIntegration.customerLinks.set('Customer:young', 'company-young');
    collectionsIntegration.customerLinks.set('Customer:oldest', 'company-oldest');
    renderPane();
    expect(screen.getByRole('link', { name: 'Review collections' })).toHaveAttribute(
      'href', '/companies/company-oldest#collections',
    );
  });

  it('AC-806-FIN-STATE-001 keeps the page frame and independent work sections when purchase reads fail', () => {
    procurementRead.isError = true;
    renderPane();
    expect(screen.getByRole('heading', { name: 'Finance Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByText('Ready to pay')).toBeInTheDocument();
    expect(screen.getByText('Budget review')).toBeInTheDocument();
  });

  it('AC-806-FIN-STATE-002 keeps financial position retry inside its disclosure', () => {
    dashboardRead.isError = true;
    renderPane();
    screen.getByText('Financial position and accounting evidence').click();
    expect(screen.getByText("Couldn't load the finance dashboard")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Ready to pay')).toBeInTheDocument();
  });
});

describe('still to invoice (OD-BILL-1 / #786)', () => {
  it('AC-UNB-005 the finance dashboard carries the still-to-invoice card', () => {
    renderPane();
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();
  });
});
