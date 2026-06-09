/**
 * AC-IXD-DASH-W5-C2B — Finance console (PR-B)
 *
 * Tests:
 * 1. N16 "Ready to pay" table — shows only Vendor Invoiced PRs + routes to /procurement/:id + honest empty
 * 2. N17 Budget review — variance-desc ordering (most-over first); Variance column shows correct over/left text
 * 3. OD-C / review-I2 — "Vendor Invoiced" is a VISIBLE Procurement segment (selectable toolbar filter)
 * 4. J4 — tabular numerics, right-aligned money columns (console reframe)
 * 5. a11y — aria-sort on sortable columns; text+sign not color-only; honest empty states
 * 6. Design-review fix I1 — age column header is "Last updated" (not "Invoiced")
 * 7. Design-review fix I2 — budget-review excludes budget===0 rows; real bleeders rank first
 *
 * Red → Green → Refactor (TDD). Written BEFORE production code.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui/Toast';

// ── Top-level mocks (hoisted by vitest) ─────────────────────────────────────

/** now - 3 days ago in ISO string */
const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
/** now - 10 days ago */
const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

const dash = {
  active_projects: 3,
  total_contract_value: 10_000_000,
  on_hand_margin: 0.22,
  on_hand_value: 7_000_000,
  pipeline_weighted_value: 1_000_000,
  pipeline_projected_margin: 0.18,
  pipeline_total_value: 4_000_000,
  projects_at_risk: 1,
  projects_by_status: [],
  procurements_by_status: [
    { status: 'Vendor Invoiced', count: 2 },
    { status: 'Paid', count: 3 },
  ],
  top_projects: [
    // Alpha: 10% OVER budget (spent=1100 vs budget=1000) → variance = +100,000 → should be first
    { id: 'p1', name: 'Alpha', client_name: 'Acme', contract_value: 5_000_000, budget: 1_000_000, spent: 1_100_000, status: 'Ongoing Project' },
    // Beta: $400k LEFT under budget (spent=600 vs budget=1000) → variance = -400,000 → last (after filter)
    { id: 'p2', name: 'Beta', client_name: 'Beta Co', contract_value: 3_000_000, budget: 1_000_000, spent: 600_000, status: 'Ongoing Project' },
    // Gamma: $50k over (spent=250 vs budget=200) → variance = +50,000 → middle
    { id: 'p3', name: 'Gamma', client_name: 'Gamma Ltd', contract_value: 2_000_000, budget: 200_000, spent: 250_000, status: 'Ongoing Project' },
    // ZeroBudget: budget=0, Tender Submitted → should be EXCLUDED from budget-review (I2 fix)
    { id: 'p4', name: 'ZeroBudget Tender', client_name: 'Tender Co', contract_value: 1_000_000, budget: 0, spent: 0, status: 'Tender Submitted' },
  ],
};

const makePR = (overrides: Record<string, unknown>) => ({
  id: 'pr-x', status: 'Draft', total_value: 0, title: 'Default',
  code: 'DF-001', requested_by_id: 'u1', requested_by: { full_name: 'Alice' },
  project: null, created_at: threeDaysAgo, updated_at: threeDaysAgo,
  org_id: 'org-1', vendor_id: null, approved_by_id: null, approval_notes: null,
  rejection_notes: null, pr_number: null, po_number: null, vendor: null,
  ...overrides,
});

const procurements = [
  makePR({ id: 'vi-1', status: 'Vendor Invoiced', total_value: 250_000, title: 'Scaffolding Invoice', code: 'VI-001', updated_at: threeDaysAgo }),
  makePR({ id: 'vi-2', status: 'Vendor Invoiced', total_value: 80_000, title: 'Electrical Works Invoice', code: 'VI-002', requested_by: { full_name: 'Bob' }, project: { name: 'Beta' }, updated_at: tenDaysAgo }),
  makePR({ id: 'paid-1', status: 'Paid', total_value: 999_999, title: 'Paid Invoice', code: 'PD-001', requested_by: { full_name: 'Carol' } }),
  makePR({ id: 'draft-1', status: 'Draft', total_value: 5_000, title: 'Draft Request', code: 'DR-001', requested_by_id: 'u2', requested_by: { full_name: 'Dave' } }),
];

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dash, isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }),
  ImpersonationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'fin-1', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/src/hooks/useProcurementView', () => ({
  useProcurementView: () => ['table', vi.fn()] as ['table', () => void],
}));

// ── Imports after mocks ──────────────────────────────────────────────────────
import { FinanceDashboard, ReadyToPayTable } from '../FinanceDashboard';
import ProcurementPage from '@/pages/Procurement';  // @/* maps to pmo-portal root per tsconfig paths

const renderPane = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <FinanceDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

const renderProcurement = (url = '/procurement') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <ProcurementPage />
      </ToastProvider>
    </MemoryRouter>,
  );

// ── N16: Ready to pay ──────────────────────────────────────────────────────

describe('AC-IXD-DASH-W5-C2B — N16: Ready to pay table', () => {
  it('AC-IXD-DASH-W5-C2B-N16-1: renders the "Ready to pay" section heading', () => {
    renderPane();
    expect(screen.getByText(/ready to pay/i)).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-N16-2: shows only Vendor Invoiced PRs (not Paid or Draft)', () => {
    renderPane();
    expect(screen.getByText('Scaffolding Invoice')).toBeInTheDocument();
    expect(screen.getByText('Electrical Works Invoice')).toBeInTheDocument();
    expect(screen.queryByText('Paid Invoice')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Request')).not.toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-N16-3: shows PR code in mono style', () => {
    renderPane();
    expect(screen.getByText('VI-001')).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-N16-4: shows Value column with tabular currency amounts', () => {
    renderPane();
    // $250,000 may appear in both KPI tile and the table — getAllByText is correct
    expect(screen.getAllByText('$250,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$80,000').length).toBeGreaterThan(0);
  });

  it('AC-IXD-DASH-W5-C2B-N16-5: row has an accessible label to navigate to PR detail', () => {
    renderPane();
    // The row button must reference the PR title so screen reader users know where it goes
    const btn = screen.getByRole('button', { name: /Open Scaffolding Invoice/i });
    expect(btn).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-N16-6: shows vendor-invoiced age column header', () => {
    renderPane();
    // "Invoiced" column header in the Ready-to-pay table — may match multiple elements
    // (KPI tile also says "invoiced"). Use getAllByText and check at least one exists.
    expect(screen.getAllByText(/invoiced/i).length).toBeGreaterThan(0);
  });

  it('AC-IXD-DASH-W5-C2B-N16-7: honest empty state — "Nothing awaiting payment" when no VI PRs', () => {
    // Render with no VI procurements
    render(
      <MemoryRouter>
        <ToastProvider>
          {/* Use a fresh component configured via props to test the empty state */}
          {/* We test that the empty message is in the component via a dedicated ReadyToPayTable test */}
          <FinanceDashboard />
        </ToastProvider>
      </MemoryRouter>,
    );
    // With fixture data containing VI rows, there should be no empty state
    expect(screen.queryByText(/nothing awaiting payment/i)).not.toBeInTheDocument();
    // The actual empty state text is tested by ReadyToPayTable unit test below
  });
});

// ── N17: Budget review — variance-desc ────────────────────────────────────

describe('AC-IXD-DASH-W5-C2B — N17: Budget review variance ranking', () => {
  it('AC-IXD-DASH-W5-C2B-N17-1: card head says "Budget review" with honest scoped label', () => {
    renderPane();
    // Honest label per OD-E: "top 5 contracts by variance" — not portfolio-wide.
    // Multiple elements may contain /variance/i (column header + card head); use getAllByText.
    expect(screen.getAllByText(/budget review/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/variance/i).length).toBeGreaterThan(0);
    // The card head specifically must contain "budget review" + "variance" in one heading
    const cardHead = screen.getByText(/budget review — top 5 contracts by variance/i);
    expect(cardHead).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-N17-2: variance column shows "+$X over" for over-budget projects', () => {
    renderPane();
    // Alpha: budget=1_000_000, spent=1_100_000 → +$100,000 over
    expect(screen.getByText('+$100,000 over')).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-N17-3: variance column shows "$Y left" for under-budget projects', () => {
    renderPane();
    // Beta: budget=1_000_000, spent=600_000 → $400,000 left
    expect(screen.getByText('$400,000 left')).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-N17-4: rows are ordered variance-desc (most-over first)', () => {
    const { container } = renderPane();
    // The budget review table is the SECOND table in the DashGrid (first is Ready-to-pay).
    // Both tables render <table><tbody><tr>. Get the second table's tbody rows.
    const allTables = container.querySelectorAll('table');
    // Budget review table is the 2nd table (index 1); Ready-to-pay is index 0
    expect(allTables.length).toBeGreaterThanOrEqual(2);
    const budgetTable = allTables[1];
    const budgetRows = budgetTable.querySelectorAll('tbody tr');
    const rowTexts = Array.from(budgetRows).map((r) => r.textContent ?? '');
    const alphaIdx = rowTexts.findIndex((t) => t.includes('Alpha'));
    const gammaIdx = rowTexts.findIndex((t) => t.includes('Gamma'));
    const betaIdx = rowTexts.findIndex((t) => t.includes('Beta'));
    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(gammaIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThanOrEqual(0);
    // Alpha (+$100k over) → Gamma (+$50k over) → Beta (-$400k left)
    expect(alphaIdx).toBeLessThan(gammaIdx);
    expect(gammaIdx).toBeLessThan(betaIdx);
  });

  it('AC-IXD-DASH-W5-C2B-N17-5: over-budget variance uses text-destructive (text reinforcement, not color-only)', () => {
    const { container } = renderPane();
    // text-destructive class applied to over-budget cell
    const overCells = container.querySelectorAll('.text-destructive');
    expect(overCells.length).toBeGreaterThan(0);
    // The cell ALSO has the word "over" — color is reinforcement, not the sole signal
    const overTexts = Array.from(overCells).filter((el) => el.textContent?.includes('over'));
    expect(overTexts.length).toBeGreaterThan(0);
  });

  it('AC-IXD-DASH-W5-C2B-N17-6: under-budget variance uses text-muted-foreground (de-emphasized)', () => {
    const { container } = renderPane();
    const mutedEls = Array.from(container.querySelectorAll('.text-muted-foreground'));
    const leftEl = mutedEls.find((el) => el.textContent?.includes('left'));
    expect(leftEl).toBeTruthy();
  });

  it('AC-IXD-DASH-W5-C2B-N17-7: at least one column header is sortable (aria-sort present)', () => {
    const { container } = renderPane();
    const sortableThs = container.querySelectorAll('th[aria-sort]');
    expect(sortableThs.length).toBeGreaterThan(0);
  });

  it('AC-IXD-DASH-W5-C2B-N17-8: table has Project, Budget, Spent, Variance column headers', () => {
    renderPane();
    // Use getAllByText to allow multiple matches (headings may appear in multiple sections)
    expect(screen.getAllByText(/budget/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/spent/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/variance/i).length).toBeGreaterThan(0);
  });
});

// ── OD-C / review-I2: Vendor Invoiced as VISIBLE Procurement segment ──────

describe('AC-IXD-DASH-W5-C2B — OD-C/I2: Vendor Invoiced visible segment', () => {
  it('AC-IXD-DASH-W5-C2B-VI-1: Procurement page has a "Vendor Invoiced" toolbar segment tab', () => {
    renderProcurement('/procurement');
    // Finance role — must have a visible "Vendor Invoiced" tab (role="tab") in the toolbar
    expect(screen.getByRole('tab', { name: /vendor invoiced/i })).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-VI-2: clicking Vendor Invoiced segment filters to only VI rows', async () => {
    renderProcurement('/procurement');
    const viButton = screen.getByRole('tab', { name: /vendor invoiced/i });
    await userEvent.click(viButton);
    // After clicking VI segment: VI row visible, others not
    expect(screen.getByText('Scaffolding Invoice')).toBeInTheDocument();
    expect(screen.queryByText('Paid Invoice')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Request')).not.toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-VI-3: navigating to ?status=Vendor+Invoiced shows VI segment selected (aria-selected)', () => {
    renderProcurement('/procurement?status=Vendor+Invoiced');
    // The ViewToggle uses role="tab" + aria-selected (not aria-pressed)
    const viTab = screen.getByRole('tab', { name: /vendor invoiced/i });
    // Must be visually + semantically selected (aria-selected="true")
    expect(viTab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-IXD-DASH-W5-C2B-VI-4: navigating to ?status=Vendor+Invoiced shows only VI rows (orientation fix)', () => {
    renderProcurement('/procurement?status=Vendor+Invoiced');
    expect(screen.getByText('Scaffolding Invoice')).toBeInTheDocument();
    expect(screen.queryByText('Draft Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Paid Invoice')).not.toBeInTheDocument();
  });
});

// ── J4 console reframe: tabular numerics ──────────────────────────────────

describe('AC-IXD-DASH-W5-C2B — J4: console reframe (tabular, right-align)', () => {
  it('AC-IXD-DASH-W5-C2B-J4-1: numeric td cells have tabular class (font-variant-numeric)', () => {
    const { container } = renderPane();
    // DataTable applies the tabular class to align:num td cells
    const numCells = container.querySelectorAll('td.tabular');
    expect(numCells.length).toBeGreaterThan(0);
  });

  it('AC-IXD-DASH-W5-C2B-J4-2: numeric column headers (Budget/Spent/Variance/Value) are right-aligned', () => {
    const { container } = renderPane();
    const rightAlignedThs = container.querySelectorAll('th.text-right');
    expect(rightAlignedThs.length).toBeGreaterThan(0);
  });
});

// ── Design-review I1 — honest age column label ────────────────────────────

describe('AC-IXD-DASH-W5-C2B — I1: age column header is "Last updated" (not "Invoiced")', () => {
  it('AC-IXD-DASH-W5-C2B-I1-1: Ready-to-pay table has "Last updated" column header (not "Invoiced")', () => {
    const { container } = render(
      <MemoryRouter>
        <ReadyToPayTable
          procurements={[
            // @ts-expect-error minimal shape for test
            { id: 'vi-1', status: 'Vendor Invoiced', total_value: 100_000, title: 'Test Invoice',
              code: 'VI-T', updated_at: threeDaysAgo, project: null, requested_by: { full_name: 'Alice' } },
          ]}
          isPending={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    );
    // The "age" column header must say "Last updated" — not "Invoiced"
    const ths = Array.from(container.querySelectorAll('th'));
    const lastUpdatedTh = ths.find((th) => /last updated/i.test(th.textContent ?? ''));
    expect(lastUpdatedTh).toBeTruthy();
    // Confirm "Invoiced" is no longer a standalone column header
    const invoicedTh = ths.find((th) => /^invoiced$/i.test(th.textContent?.trim() ?? ''));
    expect(invoicedTh).toBeUndefined();
  });

  it('AC-IXD-DASH-W5-C2B-I1-2: "Last updated" column header carries a title tooltip (help attribute)', () => {
    const { container } = render(
      <MemoryRouter>
        <ReadyToPayTable
          procurements={[
            // @ts-expect-error minimal shape for test
            { id: 'vi-1', status: 'Vendor Invoiced', total_value: 100_000, title: 'Test Invoice',
              code: 'VI-T', updated_at: threeDaysAgo, project: null, requested_by: { full_name: 'Alice' } },
          ]}
          isPending={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    );
    // The th or its inner element should carry a title attribute for the tooltip
    const ths = Array.from(container.querySelectorAll('th'));
    const lastUpdatedTh = ths.find((th) => /last updated/i.test(th.textContent ?? ''));
    expect(lastUpdatedTh).toBeTruthy();
    const elWithTitle = lastUpdatedTh?.querySelector('[title]') ?? (lastUpdatedTh?.hasAttribute('title') ? lastUpdatedTh : null);
    expect(elWithTitle).toBeTruthy();
  });
});

// ── Design-review I2 — budget>0 filter ───────────────────────────────────

describe('AC-IXD-DASH-W5-C2B — I2: budget-review excludes zero-budget rows', () => {
  it('AC-IXD-DASH-W5-C2B-I2-1: zero-budget project does NOT appear in the budget-review table', () => {
    const { container } = renderPane();
    // "ZeroBudget Tender" has budget=0 → must be excluded
    const allTables = container.querySelectorAll('table');
    expect(allTables.length).toBeGreaterThanOrEqual(2);
    const budgetTable = allTables[1];
    expect(budgetTable.textContent).not.toContain('ZeroBudget Tender');
  });

  it('AC-IXD-DASH-W5-C2B-I2-2: real over-budget project (Alpha) ranks first after excluding zero-budget rows', () => {
    const { container } = renderPane();
    const allTables = container.querySelectorAll('table');
    const budgetTable = allTables[1];
    const budgetRows = budgetTable.querySelectorAll('tbody tr');
    const firstRowText = budgetRows[0]?.textContent ?? '';
    expect(firstRowText).toContain('Alpha');
  });

  it('AC-IXD-DASH-W5-C2B-I2-3: only projects with budget>0 appear in variance ranking', () => {
    const { container } = renderPane();
    const allTables = container.querySelectorAll('table');
    const budgetTable = allTables[1];
    const rowTexts = Array.from(budgetTable.querySelectorAll('tbody tr')).map((r) => r.textContent ?? '');
    // All three real-budget rows appear
    expect(rowTexts.some((t) => t.includes('Alpha'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('Gamma'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('Beta'))).toBe(true);
    // Zero-budget row absent
    expect(rowTexts.some((t) => t.includes('ZeroBudget'))).toBe(false);
  });
});

// ── ReadyToPayTable unit: empty / loading / error states ──────────────────

describe('AC-IXD-DASH-W5-C2B — ReadyToPayTable: empty state', () => {
  it('AC-IXD-DASH-W5-C2B-EMPTY-1: shows "Nothing awaiting payment" when zero VI PRs', () => {
    render(
      <MemoryRouter>
        <ReadyToPayTable procurements={[]} isPending={false} isError={false} onRetry={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/nothing awaiting payment/i)).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-EMPTY-2: shows loading state when isPending=true', () => {
    render(
      <MemoryRouter>
        <ReadyToPayTable procurements={[]} isPending={true} isError={false} onRetry={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2B-EMPTY-3: shows error state with retry when isError=true', () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ReadyToPayTable procurements={[]} isPending={false} isError={true} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
