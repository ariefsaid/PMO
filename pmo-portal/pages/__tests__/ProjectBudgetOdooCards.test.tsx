/**
 * AC-ODA-024 (#2066): on the Odoo ledger the Budget tab's Spent and Left cards are the same Odoo figures the table shows.
 * Every figure carries its own currency; Left is computed only when budget, spend and commitments share one, and a partial
 * Spent says so. In the PMO basis nothing changes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

const state = vi.hoisted(() => ({
  onLedger: true,
  unlinked: false,
  ledgerCurrency: 'IDR',
  spendCurrency: 'USD',
  currencyDiffers: false,
  unknown: 0,
  displaySpent: undefined as { amount: number; currency: string } | undefined,
  rows: [] as Array<{ category: string; budget: number; actual: number | null }>,
  spendRows: undefined as Array<{ category: string; actual: number | null }> | undefined,
  position: {
    ledgerBasis: 'erp' as 'erp' | 'pmo', budget: 6000, spent: 1500 as number | null, openCommitment: '0',
    consumption: '1500.00' as string | null, consumptionVariance: '-4500.00' as string | null,
    budgetComparisonKnown: true, usedPercent: 25 as number | null, atRisk: false,
  },
}));

const line = (id: string, category: string, amount: number) => ({
  id, budget_version_id: 'v-active', category, description: `${category} work`, budgeted_amount: amount, actual_amount: 0, fiscal_year: 'FY-2026', org_id: 'org-1',
});
const LINES = [line('a-1', 'Labor', 5000), line('a-2', 'Materials', 800), line('a-3', 'Travel', 200)];
const ACTIVE = {
  id: 'v-active', status: 'Active', name: 'Active plan', version: 1, budget_mode: 'per_year', project_id: 'p-1', org_id: 'org-1', currency: 'USD',
  created_at: '2026-01-01T00:00:00Z', activated_at: '2026-01-02T00:00:00Z', created_by: 'u2', editor_ids: [], activation_basis: null,
  line_items: LINES, total: 6000,
};

vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetDistribution: () => ({ data: null, isSuccess: true, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [ACTIVE], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetActivationMode: () => ({ data: 'allowed', isPending: false, isError: false }),
  useBudgetActivationPrecheck: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetArchiveTargets: () => ({ data: [], refetch: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  useBudgetMutations: () => new Proxy({}, { get: () => ({ mutateAsync: vi.fn(), isPending: false }) }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({
  useBudgetPosition: () => ({
    actualsPending: false, actualsError: false, refetchActuals: vi.fn(), hasBudget: true, canSeeActual: true,
    ...state.position, displaySpent: state.displaySpent, rows: state.rows, spendRows: state.spendRows ?? state.rows, spendCurrency: state.spendCurrency, currencyDiffers: state.currencyDiffers, unknown: state.unknown,
  }),
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: null, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOdooLedger', () => ({
  useOdooProjectActuals: () => ({ onLedger: state.onLedger, linked: !state.unlinked, linkError: false, unlinked: state.unlinked }),
  useOdooLedgerCurrency: () => state.ledgerCurrency,
  useOdooLedgerHealth: () => ({
    isPending: false,
    isError: false,
    data: {
      state: 'fresh', asOf: new Date().toISOString(), caughtUp: true, lastCensus: null, check: null, lastGood: null,
      unmapped: { count: 2, debit: '90.00', credit: '0.00', accounts: ['6100'] }, unattributed: null, unlinked: null,
    },
  }),
  useOdooLedgerLines: () => ({ isPending: true }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('../project-detail/budget/BudgetErpNotice', () => ({ default: () => null }));
vi.mock('@/src/components/m365/BudgetDocumentLinks', () => ({ BudgetDocumentLinks: () => null }));
vi.mock('@/src/lib/repositories/budgetProjection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/repositories/budgetProjection')>()),
  fetchBudgetPushStatus: vi.fn().mockResolvedValue([]),
  fetchProjectFiscalCalendar: vi.fn().mockResolvedValue({ status: 'resolved', project: { start: '2026-01-01', end: '2026-12-31' }, years: [{ name: 'FY-2026', start: '2026-01-01', end: '2026-12-31' }] }),
  fetchActiveBudgetCategoryPhasing: vi.fn().mockResolvedValue({ years: {}, unphased: {} }),
  listBudgetFiscalYears: vi.fn().mockResolvedValue([]),
}));

import ProjectBudget from '../ProjectBudget';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const projectIn = (currency: string) => ({ id: 'p-1', currency, tax_treatment: 'exclusive', tax_rate: null, start_date: '2026-01-01', end_date: '2026-12-31' }) as unknown as ProjectWithRefs;

const renderPage = (project = projectIn('USD')) => render(
  <FinanceI18nTestProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/projects/p-1/budget']}>
        <ToastProvider><ProjectBudget projectId="p-1" project={project} /></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </FinanceI18nTestProvider>,
);

// Travel has no mapped Odoo account, so it reads "—" in the table.
const ROWS = [
  { category: 'Labor', budget: 5000, actual: 1200 },
  { category: 'Materials', budget: 800, actual: 300 },
  { category: 'Travel', budget: 200, actual: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.onLedger = true;
  state.unlinked = false;
  state.ledgerCurrency = 'IDR';
  state.spendCurrency = 'IDR';
  state.currencyDiffers = false;
  state.unknown = 0;
  state.displaySpent = undefined;
  state.rows = ROWS;
  state.spendRows = undefined;
  state.position = {
    ledgerBasis: 'erp', budget: 6000, spent: 1500, openCommitment: '0', consumption: '1500.00', consumptionVariance: '-4500.00',
    budgetComparisonKnown: true, usedPercent: 25, atRisk: false,
  };
  ACTIVE.currency = 'IDR';
});

describe('AC-ODA-024 Odoo ledger basis: budget, spend and project in one currency (#2066)', () => {
  it('withholds Spent and Left when the project is not linked, even if a position was cached', async () => {
    state.unlinked = true;
    renderPage(projectIn('IDR'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).not.toMatch(/Spent|Left|1,500|4,500/);
  });

  it('Spent and Left cards equal the table totals, not "unknown"', async () => {
    renderPage(projectIn('IDR'));
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    // 1,200 + 300 of the figures the table shows; Left = 6,000 budget - 1,500 spent - 0 committed.
    expect(within(table).getByText('IDR 1,500')).toBeInTheDocument();
    expect(within(table).getByText('IDR 4,500')).toBeInTheDocument();
    expect(figures.textContent).toMatch(/Spent.*IDR\s*1,500/);
    expect(figures.textContent).toMatch(/Left.*IDR\s*4,500/);
    expect(figures.textContent).not.toMatch(/Spending is unknown|Left is unknown|Comparison unavailable/);
  });

  it('a partial Spent says which budget categories it leaves out', async () => {
    renderPage(projectIn('IDR'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    // Travel has no Odoo account: Spent (and the Left built on it) state the exclusion.
    expect(within(figures).getAllByText('Excludes 1 unmapped category')).toHaveLength(2);
  });

  it('every category known: no exclusion note', async () => {
    state.rows = ROWS.map((r) => ({ ...r, actual: r.actual ?? 100 }));
    state.position = { ...state.position, spent: 1600, consumption: '1600.00', consumptionVariance: '-4400.00', usedPercent: 27 };
    renderPage(projectIn('IDR'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).not.toMatch(/Spent excludes/);
  });

  it('every category unknown: Spent says unknown, never a zero', async () => {
    state.rows = ROWS.map((r) => ({ ...r, actual: null }));
    state.position = { ...state.position, spent: null, consumption: null, consumptionVariance: null, budgetComparisonKnown: false, usedPercent: null };
    renderPage(projectIn('IDR'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    // Spent is withheld, never a zero: the page's one hidden-figures line says why.
    expect(figures.textContent).not.toMatch(/Spent/);
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/spending is not linked/i);
  });
});

describe('AC-ODA-024 Odoo ledger basis: a USD budget against IDR Odoo spend (#2066)', () => {
  beforeEach(() => {
    ACTIVE.currency = 'USD';
    // The finances read names IDR; the project is in USD, so the position holds the figures but compares none of them.
    state.spendCurrency = 'IDR';
    state.rows = ROWS.map((r) => ({ ...r, actual: null }));
    state.spendRows = ROWS;
    state.currencyDiffers = true;
    state.position = { ...state.position, spent: null, consumption: '1500.00', consumptionVariance: null, budgetComparisonKnown: false, usedPercent: null };
    state.displaySpent = { amount: 1500, currency: 'IDR' };
  });

  it('keeps each figure in its own currency: budget in USD, Odoo spend in IDR', async () => {
    renderPage(projectIn('USD'));
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Budget.*\$6,000/);
    expect(figures.textContent).toMatch(/Spent.*IDR\s*1,500/);
    expect(within(table).getByText('IDR 1,200')).toBeInTheDocument();
  });

  it('the shared hidden-figure line names each currency separately once', async () => {
    renderPage(projectIn('USD'));
    const hidden = await screen.findByTestId('figures-hidden');
    const reason = 'Budget: USD. Spending: IDR. Commitments: USD. Comparisons are unavailable across currencies.';
    expect(hidden).toHaveTextContent(reason);
    expect(screen.queryByText(reason, { exact: true })).not.toBeInTheDocument();
  });

  it('does not call mapped spending unmapped when only the comparison currency differs', async () => {
    state.unknown = 3;
    state.spendRows = ROWS.map((row) => ({ ...row, actual: row.actual ?? 100 }));
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Spent.*IDR\s*1,500/);
    expect(figures.textContent).not.toMatch(/not mapped|unmapped/i);
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/Comparisons are unavailable across currencies/i);
  });

  it('still warns when a category amount is genuinely unmapped', async () => {
    state.unknown = 3;
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/not mapped|unmapped/i);
  });

  it('never subtracts across currencies: Left gives no number and says the currencies differ', async () => {
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/Comparisons are unavailable across currencies/i);
    expect(figures.textContent).not.toMatch(/4,500/);
    expect(screen.queryByText('Over budget')).not.toBeInTheDocument();
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
  });
});

describe('AC-ODA-024 PMO basis is unchanged (#2066)', () => {
  beforeEach(() => {
    state.onLedger = false; state.spendCurrency = 'USD'; ACTIVE.currency = 'USD';
    state.position = { ledgerBasis: 'pmo', budget: 6000, spent: null, openCommitment: '0', consumption: null, consumptionVariance: null, budgetComparisonKnown: false, usedPercent: null, atRisk: false };
  });

  it('one unknown category still makes Spent and Left unknown, in the project currency', async () => {
    renderPage();
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).not.toMatch(/Spent|Left/);
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/3 figures hidden/i);
    expect(figures.textContent).toMatch(/\$/);
    expect(figures.textContent).not.toMatch(/IDR|Spent excludes/);
    expect(screen.queryByText('Amounts in IDR')).not.toBeInTheDocument();
  });

  it('with every category known, the cards equal the table totals in the project currency', async () => {
    state.rows = ROWS.map((r) => ({ ...r, actual: r.actual ?? 100 }));
    state.position = { ...state.position, spent: 1600, consumption: '1600.00', consumptionVariance: '-4400.00', budgetComparisonKnown: true, usedPercent: 27 };
    renderPage();
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    expect(within(table).getByText('$1,600')).toBeInTheDocument();
    expect(figures.textContent).toMatch(/Spent.*\$1,600/);
    expect(figures.textContent).toMatch(/Left.*\$4,400/);
  });

  it('describes unknown category allocations without saying the known project total excludes them', async () => {
    state.rows = ROWS.map((row) => ({ ...row, actual: null }));
    state.unknown = 3;
    state.position = { ...state.position, spent: 1600, budgetComparisonKnown: true };
    renderPage();
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Spent.*\$1,600/);
    expect(within(figures).getAllByText('Not split by category')).toHaveLength(2);
    expect(figures.textContent).not.toMatch(/Excludes/);
  });
});

describe('ERP ledger spending in a different currency', () => {
  beforeEach(() => {
    state.onLedger = false;
    ACTIVE.currency = 'USD';
    state.spendCurrency = 'IDR';
    state.currencyDiffers = true;
    state.unknown = 3;
    state.rows = ROWS.map((row) => ({ ...row, actual: null }));
    state.spendRows = ROWS.map((row) => ({ ...row, actual: row.actual ?? 0 }));
    state.position = { ...state.position, spent: null, budgetComparisonKnown: false, usedPercent: null };
    state.displaySpent = { amount: 1500, currency: 'IDR' };
  });

  it('shows mapped spend without an unmapped warning while comparisons are unavailable', async () => {
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Spent.*IDR\s*1,500/);
    expect(figures.textContent).not.toMatch(/not mapped|unmapped/i);
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/Comparisons are unavailable across currencies/i);
  });

  it('warns when an actual category is unknown', async () => {
    state.spendRows = ROWS;
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(within(figures).getByText('Not split by category')).toBeInTheDocument();
  });
});
