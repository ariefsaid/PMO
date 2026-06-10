/**
 * AC-W6-IXD-ATRISK (Overview) — the Budget-utilization card co-locates the
 * budget-util basis WITH the delivery-progress bar: when the project is at-risk a
 * "% of budget" caption + an "At risk" StatusPill render BELOW the existing
 * contract-basis bar. Healthy projects render the bar only. budget===0 → no caption.
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

vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
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

const renderTab = (p: ProjectWithRefs) =>
  render(
    <MemoryRouter>
      <OverviewTab project={p} setTab={vi.fn()} />
    </MemoryRouter>,
  );

beforeEach(() => {
  procState.data = [];
  budgetState.data = [];
  navigate.mockClear();
});

describe('OverviewTab — at-risk budget co-location (AC-W6-IXD-ATRISK)', () => {
  it('AC-W6-IXD-ATRISK: an at-risk project renders the bar + a "% of budget" caption + an "At risk" pill below the contract line', () => {
    // spent/budget = 850/900 = 94% (≥ 0.9 threshold) → at-risk.
    const p = { ...baseProject, budget: 900_000, spent: 850_000 } as ProjectWithRefs;
    renderTab(p);
    const bar = screen.getByRole('progressbar', { name: /of contract/i });
    expect(bar).toBeInTheDocument();
    // The caption + flag are co-located inside the same card as the bar.
    const card = bar.closest('div')!;
    expect(within(card).getByText(/94% of budget/i)).toBeInTheDocument();
    expect(within(card).getByText(/^At risk$/i)).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: a healthy project renders the bar only — no budget caption, no pill', () => {
    // spent/budget = 400/900 = 44% → healthy.
    renderTab(baseProject);
    expect(screen.getByRole('progressbar', { name: /of contract/i })).toBeInTheDocument();
    expect(screen.queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^At risk$/i)).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: budget===0 → no caption, no NaN (guarded)', () => {
    const p = { ...baseProject, budget: 0, spent: 500_000 } as ProjectWithRefs;
    renderTab(p);
    expect(screen.queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
  });
});
