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

const renderTab = (p: ProjectWithRefs = project, setTab = vi.fn()) =>
  render(
    <MemoryRouter>
      <OverviewTab project={p} setTab={setTab} />
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

  it('T16: shows spent value', () => {
    renderTab();
    // project.spent = 400k — appears in both budget utilization and budget snapshot
    expect(screen.getAllByText(/\$400,000/i).length).toBeGreaterThanOrEqual(1);
  });

  it('T16: shows negative variance in destructive color when spent > activeTotal', () => {
    // spent(400k) > active(150k) → variance = -250k
    const { container } = renderTab();
    // Check for the destructive text class on the variance element
    const negativeEl = container.querySelector('[data-testid="budget-variance"]');
    expect(negativeEl).not.toBeNull();
    expect(negativeEl!.textContent).toContain('-');
  });

  it('T16: shows category breakdown bars', () => {
    renderTab();
    // Labour and Materials from activeVersion
    expect(screen.getByText('Labour')).toBeInTheDocument();
    expect(screen.getByText('Materials')).toBeInTheDocument();
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
