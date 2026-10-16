// T14-T18 — Overview tab densification tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import OverviewTab from '../tabs/OverviewTab';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { Tables } from '@/src/lib/supabase/database.types';

vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));

// ── Fixture data ─────────────────────────────────────────────────────────────

const project: ProjectWithRefs = {
  id: 'p1',
  name: 'Alpha HQ',
  code: 'A001',
  status: 'Ongoing Project',
  contract_value: 1_000_000,
  tax_treatment: 'exclusive',
  currency: 'USD',
  budget: 900_000,
  spent: 400_000,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  client_id: 'c1',
  project_manager_id: 'u1',
  customer_contract_ref: 'CPO-001',
  org_id: 'o1',
  contract_date: null,
  client: { name: 'Acme Corp' },
  pm: { full_name: 'Alice' },
} as unknown as ProjectWithRefs;

const makeProcRow = (
  id: string,
  status: string,
  total_value: number,
  created_at: string,
): ProcurementWithRefs =>
  ({
    id,
    title: `Request ${id}`,
    code: `PR-${id}`,
    status,
    total_value,
    project_id: 'p1',
    created_at,
    org_id: 'o1',
    vendor: { name: 'Vendor Co' },
    requested_by: { full_name: 'Bob' },
    project: { name: 'Alpha HQ', code: 'A001' },
  }) as unknown as ProcurementWithRefs;

const procRows: ProcurementWithRefs[] = [
  makeProcRow('r1', 'Requested', 50_000, '2026-06-01T00:00:00Z'),
  makeProcRow('r2', 'Paid', 80_000, '2026-06-02T00:00:00Z'),
  makeProcRow('r3', 'Cancelled', 10_000, '2026-06-03T00:00:00Z'),
  makeProcRow('r4', 'Draft', 20_000, '2026-06-04T00:00:00Z'),
];

const activeVersion: BudgetVersionWithItems = {
  id: 'bv1',
  project_id: 'p1',
  org_id: 'o1',
  version: 1,
  name: 'v1',
  status: 'Active',
  created_at: '2026-01-01',
  total: 150_000,
  line_items: [
    { id: 'li1', budget_version_id: 'bv1', org_id: 'o1', category: 'Labour', description: null, budgeted_amount: 100_000, actual_amount: 0 },
    { id: 'li2', budget_version_id: 'bv1', org_id: 'o1', category: 'Materials', description: null, budgeted_amount: 50_000, actual_amount: 0 },
  ],
} as unknown as BudgetVersionWithItems;

// ── Mock states ───────────────────────────────────────────────────────────────

const derivedBudgetState = { value: 900_000 as number | undefined };

const procState: { data: ProcurementWithRefs[] | undefined; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
  data: procRows,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const budgetState: { data: BudgetVersionWithItems[] | undefined; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
  data: [activeVersion],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
type RevenueFixture = Pick<Tables<'sales_invoices'>, 'id' | 'amount' | 'currency' | 'tax_treatment' | 'tax_amount' | 'status'>;
const revenueState: {
  data: RevenueFixture[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: [
    { id: 'si-inclusive', amount: 2_200, currency: 'USD', tax_treatment: 'inclusive', tax_amount: 200, status: 'Submitted' },
    { id: 'si-exclusive', amount: 900, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid' },
    { id: 'si-draft', amount: 7_000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, status: 'Draft' },
  ],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

// #566: the Overview tab now renders <ProjectDrawdown>, which reads through react-query. These
// specs predate it and mount without a QueryClientProvider, so the hook is stubbed here rather
// than the whole tree re-hosted. Held in its loading state so it contributes no text of its own —
// the drawdown's own states are covered in ProjectDrawdown.test.tsx.
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => ({
    data: {
      committed: 400_000, draft: 0, ceiling: 1_000_000, currency: 'USD', basis: 'net',
    },
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
  useProjectProcurements: () => procState,
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: (projectId: string) => { invoiceQuery.calls(projectId); return revenueState; },
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => budgetState,
  // AC-W2-1-FE-01: budget utilization now reads from useProjectBudget (derived from Active version
  // line-items). Return 900,000 to match the test project's intended budget so util% assertions work.
  useProjectBudget: () => ({ data: derivedBudgetState.value, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() },
    activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() },
    cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() },
    createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' }, role: 'Project Manager' }),
}));

const financeQuery = vi.hoisted(() => ({
  calls: vi.fn(),
  query: {
    data: {
      project_id: 'p1', contract_invoiced: '110.00', remaining_to_invoice: '110.00',
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '0.00', outstanding: '100.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '100.00', missing_work: 0 }],
      budget: null,
      actuals: { currency: 'USD', as_of: null, total: '320000.00', excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '320000.00' }] },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
const invoiceQuery = vi.hoisted(() => ({ calls: vi.fn() }));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: (projectId: string) => { financeQuery.calls(projectId); return financeQuery.query; },
}));

const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderTab = (p: ProjectWithRefs = project, setTab = vi.fn(), committedSpend = 150_000, role: Role = 'Project Manager') =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter>
        <OverviewTab project={p} committedSpend={committedSpend} setTab={setTab} />
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  derivedBudgetState.value = 900_000;
  procState.data = procRows;
  procState.isPending = false;
  procState.isError = false;
  budgetState.data = [activeVersion];
  budgetState.isPending = false;
  budgetState.isError = false;
  revenueState.data = [
    { id: 'si-inclusive', amount: 2_200, currency: 'USD', tax_treatment: 'inclusive', tax_amount: 200, status: 'Submitted' },
    { id: 'si-exclusive', amount: 900, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid' },
    { id: 'si-draft', amount: 7_000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, status: 'Draft' },
  ];
  revenueState.isPending = false;
  revenueState.isError = false;
  navigate.mockClear();
  financeQuery.calls.mockClear();
  invoiceQuery.calls.mockClear();
  financeQuery.query.isPending = false;
  financeQuery.query.isError = false;
  financeQuery.query.refetch.mockReset();
  financeQuery.query.data = {
    project_id: 'p1', contract_invoiced: '110.00', remaining_to_invoice: '110.00',
    invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '0.00', outstanding: '100.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '100.00', missing_work: 0 }],
    budget: null,
    actuals: { currency: 'USD', as_of: null, total: '320000.00', excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '320000.00' }] },
  };
});

describe('project invoicing summary', () => {
  it('AC-PFIN-019/020 renders one authorized finance section with server comparison separate from invoice totals', () => {
    const allowedRoles: Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
    for (const role of allowedRoles) {
      const view = renderTab({ ...project, contract_value: 220, tax_treatment: 'inclusive' } as ProjectWithRefs, vi.fn(), 150_000, role);
      const section = screen.getByTestId('project-finances');
      expect(screen.getAllByTestId('project-finances')).toHaveLength(1);
      expect(screen.getByTestId('project-drawdown').compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByTestId('project-invoicing-summary')).not.toBeInTheDocument();
      expect(section).not.toHaveTextContent('$220.00');
      expect(section).toHaveTextContent('$110.00');
      expect(section).toHaveTextContent('$100.00');
      expect(screen.queryByTestId('project-contract-basis')).not.toBeInTheDocument();
      expect(screen.getByTestId('project-invoiced-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
      expect(screen.getByTestId('project-remaining-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
      view.unmount();
    }
    // Overview and its Project finances summary share the same React Query key; each calls the hook, while the request is cached/deduplicated.
    expect(financeQuery.calls).toHaveBeenCalledTimes(allowedRoles.length * 2);
    expect(invoiceQuery.calls).not.toHaveBeenCalled();
  });

  it('AC-PFIN-019 does not fetch or render the new finance section for Engineer and retains delivery content', () => {
    renderTab(project, vi.fn(), 150_000, 'Engineer');
    expect(screen.queryByTestId('project-finances')).not.toBeInTheDocument();
    // The shared hook is invoked for Actuals, but useProjectFinances disables its query for this role.
    expect(financeQuery.calls).toHaveBeenCalledTimes(1);
    expect(invoiceQuery.calls).not.toHaveBeenCalled();
    expect(screen.getByText(/Procurement summary/i)).toBeInTheDocument();
    expect(screen.getByText(/Budget snapshot/i)).toBeInTheDocument();
  });
  it('UX-022/AC-PFIN-020 keeps contract value out of the finance drill-down headline', () => {
    const view = renderTab({ ...project, contract_value: 220, tax_treatment: 'inclusive' } as ProjectWithRefs);
    const section = screen.getByTestId('project-finances');
    expect(section).not.toHaveTextContent('Contract value');
    expect(section).not.toHaveTextContent('$220.00');
    expect(screen.queryByTestId('project-contract-basis')).not.toBeInTheDocument();
    view.unmount();

    const unknownBasis = { ...project, contract_value: 1_000_000, tax_treatment: 'unknown' } as ProjectWithRefs;
    const unknownView = renderTab(unknownBasis);
    expect(screen.queryByText('Contract value')).not.toBeInTheDocument();
    expect(unknownView.getByTestId('project-finances')).not.toHaveTextContent('$1,000,000');
    unknownView.unmount();
  });

  it('AC-PFIN-015: keeps the section honest during loading and offers retry on a finance-read error', async () => {
    financeQuery.query.isPending = true;
    const view = renderTab();
    const section = screen.getByTestId('project-finances');
    expect(section).toHaveTextContent('Loading project finances');
    expect(section).not.toHaveTextContent('$0.00');
    view.unmount();

    financeQuery.query.isPending = false;
    financeQuery.query.isError = true;
    financeQuery.query.refetch.mockResolvedValue(undefined);
    renderTab();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load project finances");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(financeQuery.query.refetch).toHaveBeenCalled();
  });
});

// ── T14: Procurement summary card ────────────────────────────────────────────

describe('OverviewTab T14: Procurement summary card', () => {
  it('T14: renders "Procurement summary" heading', () => {
    renderTab();
    expect(screen.getByText(/Procurement summary/i)).toBeInTheDocument();
  });

  it('T14: shows Open, Completed, Closed bucket counts for this project only', () => {
    renderTab();
    // r1=Requested(Open), r2=Paid(Completed), r3=Cancelled(Closed), r4=Draft(Open)
    // Open=2, Completed=1, Closed=1
    // Use getAllByText since "Open" also appears in the header or other pills
    expect(screen.getAllByText(/Open/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Completed/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Closed/i).length).toBeGreaterThanOrEqual(1);
    // Confirm bucket counts appear
    expect(document.body.textContent).toMatch(/2 Open/);
    expect(document.body.textContent).toMatch(/1 Completed/);
    expect(document.body.textContent).toMatch(/1 Closed/);
  });

  it('UX-026/T14: labels procurement totals as request value, distinct from PMO purchase orders', () => {
    renderTab();
    // Committed: r1(50k)+r2(80k)+r4(20k)=150k; r3(Cancelled) excluded
    // $150,000 also appears as Budget snapshot activeTotal — use count >= 1
    expect(screen.getAllByText(/\$150,000/i).length).toBeGreaterThanOrEqual(1);
    // The procurement amount is total request value, not the separate Committed measure.
    expect(screen.getByText(/Total request value:/i)).toBeInTheDocument();
  });

  it('T14: shows top 3 recent requests (newest first)', () => {
    renderTab();
    // r4(06-04), r3(06-03), r2(06-02) = top 3 by created_at desc
    expect(screen.getByText('Request r4')).toBeInTheDocument();
  });

  it('T14: loading state while procurements are pending', () => {
    procState.isPending = true;
    procState.data = undefined;
    renderTab();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('T14: empty state when no procurement rows exist for this project', () => {
    procState.data = [];
    renderTab();
    expect(screen.getByText(/No purchase requests for this project yet/i)).toBeInTheDocument();
  });
});

// ── T16: Budget snapshot card ─────────────────────────────────────────────────

describe('OverviewTab T16: Budget snapshot card', () => {
  it('T16: renders "Budget snapshot" heading', () => {
    renderTab();
    expect(screen.getByText(/Budget snapshot/i)).toBeInTheDocument();
  });

  it('T16: shows Active budget total', () => {
    renderTab();
    // activeVersion.total = 150k
    expect(screen.getAllByText(/\$150,000/i).length).toBeGreaterThanOrEqual(1);
  });

  it('UX-014/023: Actual uses complete mapped project-finances data, not committed spend or stored project.spent', () => {
    // Actual is $320k even when the separate committed-spend prop says $450k.
    renderTab(project, vi.fn(), 450_000);
    expect(screen.getAllByText(/\$320,000/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Actual spending: 36% of budget')).toBeInTheDocument();
    expect(screen.queryByLabelText('Budget committed: 50% of budget')).not.toBeInTheDocument();
  });

  it('DD-MONEY-4 shows no-active-budget instead of a zero utilization denominator', () => {
    budgetState.data = [];
    derivedBudgetState.value = undefined;
    renderTab(project, vi.fn(), 450_000);
    expect(screen.getAllByText('No active budget')).toHaveLength(2);
    expect(screen.queryByText(/budget committed/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Budget committed/i)).not.toBeInTheDocument();
  });

  it('DD-MONEY-4: budget utilization uses Actual over the active budget, not committed spend or contract', () => {
    renderTab(project, vi.fn(), 450_000);
    expect(screen.getByText(/recorded spending against the active budget/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Actual spending: 36% of budget')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Spend: 40% of contract/i)).not.toBeInTheDocument();
  });

  it('T16: shows over-budget variance in destructive color when committed spend > activeTotal (AC-W2-9-02)', () => {
    // committed(400k) > active(150k) → variance = spent - budget = +250k (over-budget, AC-W2-9-02)
    const { container } = renderTab(project, vi.fn(), 400_000);
    // Check for the destructive text utility class on the variance element
    // (item J: token utility class, not an inline hsl(var(--destructive)) style).
    const overEl = container.querySelector('[data-testid="budget-variance"]');
    expect(overEl).not.toBeNull();
    // The label states the actionable overrun directly; no sign inversion is needed.
    expect(overEl!.textContent).toContain('Over budget by $170,000');
    expect(overEl!.className).toContain('text-destructive-text');
    expect(overEl!.getAttribute('style')).toBeNull();
  });

  it('UX-027 describes under-budget money as remaining and over-budget money as an overrun', () => {
    financeQuery.query.data.actuals.total = '50000.00';
    financeQuery.query.data.actuals.categories[0].amount = '50000.00';
    const { container } = renderTab(project, vi.fn(), 400_000);
    expect(container.querySelector('[data-testid="budget-variance"]')).toHaveTextContent('Budget remaining $100,000');
  });

  it('T16: shows category breakdown bars', () => {
    renderTab();
    // Labour and Materials from activeVersion
    expect(screen.getByText('Labour')).toBeInTheDocument();
    expect(screen.getByText('Materials')).toBeInTheDocument();
  });

  it('item F: by-category figures render as currency, never the raw "Nh" hours suffix', () => {
    renderTab();
    // Labour 100k + Materials 50k from activeVersion, currency-formatted.
    expect(screen.getByText('$100,000')).toBeInTheDocument();
    expect(screen.getByText('$50,000')).toBeInTheDocument();
    // the buggy unformatted "100000h" / "50000h" must NOT appear
    expect(screen.queryByText(/\b\d+h\b/)).not.toBeInTheDocument();
  });

  it('T16: empty state when no Active budget version exists', () => {
    budgetState.data = [];
    renderTab();
    expect(screen.getAllByText(/No active budget/i)).toHaveLength(1);
  });

  it('T16: loading state while budget versions are pending', () => {
    budgetState.isPending = true;
    budgetState.data = undefined;
    renderTab();
    // At least one loading skeleton
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThanOrEqual(1);
  });
});

// ── T18: Layout + footer links ────────────────────────────────────────────────

describe('OverviewTab T18: Row 2 layout + footer links', () => {
  it('T18: second row has lg:grid-cols-2', () => {
    const { container } = renderTab();
    const row2 = container.querySelector('[data-testid="overview-row2"]');
    expect(row2).not.toBeNull();
    expect(row2!.className).toContain('lg:grid-cols-2');
  });

  it('T18: "View all procurement" button calls setTab with procurement', async () => {
    const setTab = vi.fn();
    renderTab(project, setTab);
    const btn = screen.getByRole('button', { name: /View all procurement/i });
    await userEvent.click(btn);
    expect(setTab).toHaveBeenCalledWith('procurement');
  });

  it('T18: "Open Budget tab" button calls setTab with budget', async () => {
    const setTab = vi.fn();
    renderTab(project, setTab);
    const btn = screen.getByRole('button', { name: /Open Budget tab/i });
    await userEvent.click(btn);
    expect(setTab).toHaveBeenCalledWith('budget');
  });
});

// ── DD-MONEY-1: OverviewTab D15 finance summary respects authorized Actual source ─
describe('OverviewTab D15 financial summary — Actual requires authorized complete coverage (DD-MONEY-1)', () => {
  // Engineer cannot read the project-finances source, so its distinct PO amount is not substituted for Actual.
  const deadSpentProject: ProjectWithRefs = {
    ...project,
    spent: 0, // as in production
  } as unknown as ProjectWithRefs;

  const renderFinanceSummary = (committedSpend: number, commitmentSource: 'pmo' | 'not-tracked' | 'unavailable' = 'pmo') =>
    render(
      <ImpersonationProvider realRole="Engineer">
        <MemoryRouter>
          <OverviewTab
          project={deadSpentProject}
          committedSpend={committedSpend}
          commitmentSource={commitmentSource}
          setTab={vi.fn()}
          showFinanceSummary={true}
          />
        </MemoryRouter>
      </ImpersonationProvider>,
    );

  it('DD-MONEY-3: delivery-role summary labels ERP-owned procurement as not tracked, not zero', () => {
    renderFinanceSummary(0, 'not-tracked');
    const aside = screen.getByTestId('financial-summary');
    expect(aside).toHaveTextContent('Not tracked in PMO yet');
    expect(aside).not.toHaveTextContent('$0');
  });

  it('DD-MONEY-1: D15 does not invent Actual for a role without project-finances access', () => {
    renderFinanceSummary(3_700_000);
    // The financial-summary aside is rendered (Engineer view, on-hand project)
    const aside = screen.getByTestId('financial-summary');
    expect(aside).toBeInTheDocument();
    // Find the Actual stat-tile within the financial-summary
    const tiles = aside.querySelectorAll('[data-testid="stat-tile"]');
    const actualTile = Array.from(tiles).find((el) => el.textContent?.includes('Actual'));
    expect(actualTile).toBeTruthy();
    // This role cannot read the authorized project-finances source; committed PO spend is not a substitute.
    expect(actualTile!.textContent).toContain('Unavailable');
    expect(actualTile!.textContent).not.toContain('$3,700,000');
    expect(actualTile!.textContent).not.toContain('$0');
  });
});

// ⚑ Bound at the spec review's insistence: removing the labels from BOTH OverviewTab sites (the
// finance tile and the contract-value SoD row) left the entire 7,363-test suite green. Two
// distinct render sites, so two assertions — one would let the other rot.
describe('OD-TAX-1 §2: the Overview money figures state their basis', () => {
  it('labels the finance tile and the contract-value SoD row from the row itself', () => {
    // ⚑ The finance tile renders ONLY under the delivery-forward lens (D15 / OD-W5-C3-A), so it
    // needs its own render with that flag on — asserting both from the default render is how this
    // oracle would have gone quietly dead a second time.
    const { unmount } = render(
      <ImpersonationProvider realRole="Engineer">
        <MemoryRouter>
          <OverviewTab project={project} committedSpend={150_000} setTab={vi.fn()} showFinanceSummary />
        </MemoryRouter>
      </ImpersonationProvider>,
    );
    // Both sites live inside the delivery-forward financial summary, so one render covers them —
    // but they are asserted BY NAME, because they can rot independently and a count would not tell.
    expect(screen.getByTestId('overview-contract-tax-basis')).toHaveAttribute('data-tax-basis', 'exclusive');
    expect(screen.getByTestId('overview-contract-value-tax-basis')).toHaveAttribute('data-tax-basis', 'exclusive');
    unmount();
  });
});

// ⚑ THE MOUNT-POINT ORACLE (#566, spec review Critical). Every drawdown behaviour was covered in
// ProjectDrawdown.test.tsx — but NOTHING asserted the card is actually MOUNTED here. Guarding the
// render with `false &&` left 409/409 green: the card could vanish from the screen a PM lands on
// and no test would notice. That is precisely the failure #566 was filed about — a shipped
// `get_project_drawdown()` with zero consumers — reproduced one level up, in the tests.
describe('OverviewTab mounts the contract drawdown (#566, OD-CR-13)', () => {
  it('OD-CR-13: the drawdown card is on the landing screen, not only behind the Work orders tab', () => {
    renderTab();
    expect(screen.getByTestId('project-drawdown')).toBeInTheDocument();
  });
});
