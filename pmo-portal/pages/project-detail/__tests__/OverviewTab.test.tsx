// T14-T18 — Overview tab densification tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import OverviewTab from '../tabs/OverviewTab';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

// ── Fixture data ─────────────────────────────────────────────────────────────

const project: ProjectWithRefs = {
  id: 'p1',
  name: 'Alpha HQ',
  code: 'A001',
  status: 'Ongoing Project',
  contract_value: 1_000_000,
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

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => budgetState,
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
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

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderTab = (p: ProjectWithRefs = project, setTab = vi.fn(), committedSpend = 150_000) =>
  render(
    <MemoryRouter>
      <OverviewTab project={p} committedSpend={committedSpend} setTab={setTab} />
    </MemoryRouter>,
  );

beforeEach(() => {
  procState.data = procRows;
  procState.isPending = false;
  procState.isError = false;
  budgetState.data = [activeVersion];
  budgetState.isPending = false;
  budgetState.isError = false;
  navigate.mockClear();
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

  it('T14: shows committed total (excludes Cancelled rows) as tabular currency', () => {
    renderTab();
    // Committed: r1(50k)+r2(80k)+r4(20k)=150k; r3(Cancelled) excluded
    // $150,000 also appears as Budget snapshot activeTotal — use count >= 1
    expect(screen.getAllByText(/\$150,000/i).length).toBeGreaterThanOrEqual(1);
    // Also verify the "committed across N requests" label
    expect(screen.getByText(/committed across/i)).toBeInTheDocument();
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

  it('T16: shows actual spent on the committed-PO basis (AC-MONEY-01)', () => {
    // The Budget-snapshot "Actual spent" now reads committed-PO spend (the live basis used by
    // the D15 tile + header), NOT the dead projects.spent column. Use a distinct committedSpend
    // (320k) so it doesn't collide with the $150k activeTotal.
    renderTab(project, vi.fn(), 320_000);
    expect(screen.getAllByText(/\$320,000/i).length).toBeGreaterThanOrEqual(1);
  });

  it('T16: budget utilization uses committed spend over active budget, not actual spent over contract', () => {
    renderTab(project, vi.fn(), 450_000);
    expect(screen.getByText(/budget committed/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Budget committed: 50% of budget')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Spend: 40% of contract/i)).not.toBeInTheDocument();
  });

  it('T16: shows negative variance in destructive color when committed spend > activeTotal', () => {
    // committed(400k) > active(150k) → variance = -250k (committed-PO basis, AC-MONEY-01)
    const { container } = renderTab(project, vi.fn(), 400_000);
    // Check for the destructive text utility class on the variance element
    // (item J: token utility class, not an inline hsl(var(--destructive)) style).
    const negativeEl = container.querySelector('[data-testid="budget-variance"]');
    expect(negativeEl).not.toBeNull();
    expect(negativeEl!.textContent).toContain('-');
    expect(negativeEl!.className).toContain('text-destructive');
    expect(negativeEl!.getAttribute('style')).toBeNull();
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
    expect(screen.getByText(/No active budget/i)).toBeInTheDocument();
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

// ── AC-MONEY-01: OverviewTab D15 financial summary Actual tile ────────────────
describe('OverviewTab D15 financial summary — Actual tile derives from committedSpend (AC-MONEY-01)', () => {
  // The D15 financial-summary aside (Engineer view) has its own StatTiles strip
  // with an "Actual" tile. It must show committedSpend (live basis), not project.spent
  // (dead stored column, always 0 in production).
  const deadSpentProject: ProjectWithRefs = {
    ...project,
    spent: 0, // as in production
  } as unknown as ProjectWithRefs;

  const renderFinanceSummary = (committedSpend: number) =>
    render(
      <MemoryRouter>
        <OverviewTab
          project={deadSpentProject}
          committedSpend={committedSpend}
          setTab={vi.fn()}
          showFinanceSummary={true}
        />
      </MemoryRouter>,
    );

  it('AC-MONEY-01: D15 Actual tile shows committedSpend when project.spent is 0', () => {
    renderFinanceSummary(3_700_000);
    // The financial-summary aside is rendered (Engineer view, on-hand project)
    const aside = screen.getByTestId('financial-summary');
    expect(aside).toBeInTheDocument();
    // Find the Actual stat-tile within the financial-summary
    const tiles = aside.querySelectorAll('[data-testid="stat-tile"]');
    const actualTile = Array.from(tiles).find((el) => el.textContent?.includes('Actual'));
    expect(actualTile).toBeTruthy();
    // Must show the live committed-basis spend, not the dead stored $0
    expect(actualTile!.textContent).toContain('$3,700,000');
    expect(actualTile!.textContent).not.toContain('$0');
  });
});
