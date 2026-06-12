/**
 * AC-W6-IXD-ATRISK (Overview) — the Budget-utilization card uses the committed
 * PO basis. When committed spend is at-risk, a "% of budget" caption + an
 * "At risk" StatusPill render below the budget-committed bar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import OverviewTab from '../tabs/OverviewTab';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

const baseProject = {
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

const procState = { data: [] as ProcurementWithRefs[], isPending: false, isError: false, refetch: vi.fn() };
const budgetState = { data: [] as BudgetVersionWithItems[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => budgetState,
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({}),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' }, role: 'Project Manager' }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderTab = (p: ProjectWithRefs, committedSpend = 0) =>
  render(
    <MemoryRouter>
      <OverviewTab project={p} committedSpend={committedSpend} setTab={vi.fn()} />
    </MemoryRouter>,
  );

beforeEach(() => {
  procState.data = [];
  budgetState.data = [];
  navigate.mockClear();
});

describe('OverviewTab — at-risk budget co-location (AC-W6-IXD-ATRISK)', () => {
  it('AC-W6-IXD-ATRISK: an at-risk project renders the committed-budget bar + a "% of budget" caption + an "At risk" pill', () => {
    // committed/budget = 850/900 = 94% (>= 0.9 threshold) -> at-risk.
    const p = { ...baseProject, budget: 900_000, spent: 0 } as ProjectWithRefs;
    renderTab(p, 850_000);
    const bar = screen.getByRole('progressbar', { name: /budget committed/i });
    expect(bar).toBeInTheDocument();
    // The caption + flag are co-located inside the same card as the bar.
    const card = bar.closest('div')!;
    expect(within(card).getByText(/94% of budget/i)).toBeInTheDocument();
    expect(within(card).getByText(/^At risk$/i)).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: a healthy project renders the bar only — no budget caption, no pill', () => {
    // committed/budget = 400/900 = 44% -> healthy.
    renderTab(baseProject, 400_000);
    expect(screen.getByRole('progressbar', { name: /budget committed/i })).toBeInTheDocument();
    expect(screen.queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^At risk$/i)).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: budget===0 → no caption, no NaN (guarded)', () => {
    const p = { ...baseProject, budget: 0, spent: 500_000 } as ProjectWithRefs;
    renderTab(p, 500_000);
    expect(screen.queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
  });
});
