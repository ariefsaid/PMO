/**
 * AC-W6-IXD-ATRISK — Projects list co-locates the budget-util basis WITH the
 * delivery-progress bar. The budget basis lives in the new "Budget used" column, while
 * the Project/name cell carries only identity + at-risk pill. Healthy rows still have
 * a Budget used value; budget===0 → muted dash, no NaN.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { projectsState, myTasksState, deliverySummaryState, projectMoneyState } = vi.hoisted(() => ({
  projectsState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  myTasksState: { data: [] as Array<Record<string, unknown>> },
  deliverySummaryState: {
    'p-risk': { deliveryPct: 32, committedSpend: 95_000, budget: 100_000 },
    'p-safe': { deliveryPct: 50, committedSpend: 40_000, budget: 80_000 },
    'p-zero': { deliveryPct: null, committedSpend: 0, budget: 0 },
  },
  projectMoneyState: { data: {} as Record<string, unknown>, isPending: false, isError: false, refetch: vi.fn() },
}));

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => myTasksState }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState }),
}));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => projectMoneyState }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import Projects from '../Projects';

const atRisk = {
  id: 'p-risk',
  name: 'At Risk Project',
  code: 'P-RISK',
  status: 'Ongoing Project',
  project_manager_id: 'pm-1',
  client_id: 'c1',
  contract_value: 200_000, currency: 'USD',
  budget: 100_000,
  spent: 95_000, // 95% of budget → at risk; 47.5% of contract on the bar
  customer_contract_ref: null,
  client: { id: 'c1', name: 'Acme' },
  pm: { id: 'pm-1', full_name: 'Alice PM' },
};

const healthy = {
  id: 'p-safe',
  name: 'Safe Project',
  code: 'P-SAFE',
  status: 'Ongoing Project',
  project_manager_id: 'pm-1',
  client_id: 'c1',
  contract_value: 100_000, currency: 'USD',
  budget: 80_000,
  spent: 40_000, // 50% of budget → healthy
  customer_contract_ref: null,
  client: { id: 'c1', name: 'Acme' },
  pm: { id: 'pm-1', full_name: 'Alice PM' },
};

const zeroBudget = {
  id: 'p-zero',
  name: 'Zero Budget Project',
  code: 'P-ZERO',
  status: 'Ongoing Project',
  project_manager_id: 'pm-1',
  client_id: 'c1',
  contract_value: 100_000, currency: 'USD',
  budget: 0,
  spent: 50_000,
  customer_contract_ref: null,
  client: { id: 'c1', name: 'Acme' },
  pm: { id: 'pm-1', full_name: 'Alice PM' },
};

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={['/projects']}>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  projectsState.data = [atRisk, healthy];
  projectsState.isPending = false;
  projectsState.isError = false;
  myTasksState.data = [];
  projectMoneyState.isPending = false;
  projectMoneyState.isError = false;
  projectMoneyState.data = {
    'p-risk': { actuals: { currency: 'USD', total: '95000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '95000.00' }] }, activeBudgetAmount: '100000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    'p-safe': { actuals: { currency: 'USD', total: '40000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '40000.00' }] }, activeBudgetAmount: '80000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    'p-zero': { actuals: { currency: 'USD', total: '0.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] }, activeBudgetAmount: '0.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
  };
});

describe('Projects list — at-risk budget co-location (AC-W6-IXD-ATRISK)', () => {
  it('AC-W6-IXD-ATRISK: an at-risk row renders the "% of budget" caption in the Budget used cell', () => {
    renderPage();
    const row = screen.getByText('At Risk Project').closest('tr')!;
    // Use aria-label on the progressbar to find the budget-used cell (robust to column-count changes)
    const budgetBar = within(row).getByRole('progressbar', { name: '95% of Active budget' });
    expect(budgetBar).toHaveAttribute('aria-label', '95% of Active budget');
    // PL-A: the "x of y" detail is the bar's title, not a second line of text.
    expect(budgetBar.closest('[title]')).toHaveAttribute('title', '$95,000.00 of $100,000.00 Active budget');
    expect(within(row).queryByText(/of .* Active budget/)).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: the budget caption is ABSENT from the Project/name and Progress cells', () => {
    renderPage();
    const row = screen.getByText('At Risk Project').closest('tr')!;
    const nameCell = within(row).getByRole('button', { name: 'At Risk Project' }).closest('td')!;
    // Find the progress cell (delivery %) by finding the progressbar whose label is Delivery
    const deliveryBar = within(row).getByRole('progressbar', { name: 'Delivery 32%' });
    const progressCell = deliveryBar.closest('td')!;
    expect(within(nameCell).queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(within(progressCell).queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(within(row).getAllByText(/^At risk$/i)).toHaveLength(1);
    expect(within(nameCell).getByText(/^At risk$/i)).toBeInTheDocument();
  });

  it('AC-TBL-CARDS-001: the phone project card shows At risk once', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    renderPage();
    const card = screen.getByText('At Risk Project').closest('li')!;
    expect(within(card).getAllByText(/^At risk$/i)).toHaveLength(1);
    expect(within(card).getByRole('progressbar', { name: '95% of Active budget' }).closest('[title]')).toHaveAttribute('title', '$95,000.00 of $100,000.00 Active budget');
  });

  it('AC-W6-IXD-ATRISK: a healthy row still renders Budget used in its own column', () => {
    renderPage();
    const row = screen.getByText('Safe Project').closest('tr')!;
    // Seek by aria-label — robust to column count (a rowMenu column was added)
    const budgetBar = within(row).getByRole('progressbar', { name: '50% of Active budget' });
    expect(budgetBar).toHaveAttribute('aria-label', '50% of Active budget');
    expect(budgetBar.closest('[title]')).toHaveAttribute('title', '$40,000.00 of $80,000.00 Active budget');
  });

  it('AC-W6-IXD-ATRISK: budget===0 → no caption, no NaN', () => {
    projectsState.data = [zeroBudget];
    renderPage();
    const row = screen.getByText('Zero Budget Project').closest('tr')!;
    expect(within(row).queryByText(/NaN/i)).not.toBeInTheDocument();
    // A known zero Active budget is not confused with an absent budget.
    expect(within(row).queryByRole('progressbar', { name: /Active budget/i })).toBeNull();
    expect(within(row).getByText('$0 Active budget; usage unavailable')).toBeInTheDocument();
  });
});
