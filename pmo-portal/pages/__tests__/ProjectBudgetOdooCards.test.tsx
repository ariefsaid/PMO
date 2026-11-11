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
  ledgerCurrency: 'IDR',
  spendCurrency: 'USD',
  currencyDiffers: false,
  rows: [] as Array<{ category: string; budget: number; actual: number | null }>,
  spendRows: undefined as Array<{ category: string; actual: number | null }> | undefined,
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
    rows: state.rows, spendRows: state.spendRows ?? state.rows, spendCurrency: state.spendCurrency, currencyDiffers: state.currencyDiffers, unknown: 0,
  }),
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: null, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOdooLedger', () => ({
  useOdooProjectActuals: () => ({ onLedger: state.onLedger, linked: true, linkError: false, unlinked: false }),
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
  state.ledgerCurrency = 'IDR';
  state.spendCurrency = 'IDR';
  state.currencyDiffers = false;
  state.rows = ROWS;
  state.spendRows = undefined;
  ACTIVE.currency = 'IDR';
});

describe('AC-ODA-024 Odoo ledger basis: budget, spend and project in one currency (#2066)', () => {
  it('Spent and Left cards equal the table totals, not "unknown"', async () => {
    renderPage(projectIn('IDR'));
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    // 1,200 + 300 of the figures the table shows; Left = 6,000 budget - 1,500 spent - 0 committed.
    expect(within(table).getByText('1,500')).toBeInTheDocument();
    expect(within(table).getByText('4,500')).toBeInTheDocument();
    expect(figures.textContent).toMatch(/Spent.*IDR\s*1,500/);
    expect(figures.textContent).toMatch(/Left.*IDR\s*4,500/);
    expect(figures.textContent).not.toMatch(/Spending is unknown|Left is unknown|Comparison unavailable/);
  });

  it('a partial Spent says which budget categories it leaves out', async () => {
    renderPage(projectIn('IDR'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    // Travel has no Odoo account: Spent (and the Left built on it) state the exclusion.
    expect(within(figures).getAllByText('Excludes 1 unmapped categories')).toHaveLength(2);
  });

  it('every category known: no exclusion note', async () => {
    state.rows = ROWS.map((r) => ({ ...r, actual: r.actual ?? 100 }));
    renderPage(projectIn('IDR'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).not.toMatch(/Spent excludes/);
  });

  it('every category unknown: Spent says unknown, never a zero', async () => {
    state.rows = ROWS.map((r) => ({ ...r, actual: null }));
    renderPage(projectIn('IDR'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    // Spent is withheld, never a zero: the page's one hidden-figures line says why.
    expect(figures.textContent).not.toMatch(/Spent/);
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/figures hidden: spending is not linked/i);
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
  });

  it('keeps each figure in its own currency: budget in USD, Odoo spend in IDR', async () => {
    renderPage(projectIn('USD'));
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Budget.*\$6,000/);
    expect(figures.textContent).toMatch(/Spent.*IDR\s*1,500/);
    expect(within(table).getByText('IDR 1,200')).toBeInTheDocument();
  });

  it('the notice names each currency separately: budget USD, spending IDR, commitments USD', async () => {
    renderPage(projectIn('USD'));
    const notice = await screen.findByText(/Comparisons are unavailable across currencies/);
    expect(notice.textContent).toBe('Budget: USD. Spending: IDR. Commitments: USD. Comparisons are unavailable across currencies.');
  });

  it('never subtracts across currencies: Left gives no number and says the currencies differ', async () => {
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/different currencies/i);
    expect(figures.textContent).not.toMatch(/4,500/);
    expect(screen.queryByText('Over budget')).not.toBeInTheDocument();
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
  });
});

describe('AC-ODA-024 PMO basis is unchanged (#2066)', () => {
  beforeEach(() => { state.onLedger = false; state.spendCurrency = 'USD'; ACTIVE.currency = 'USD'; });

  it('one unknown category still makes Spent and Left unknown, in the project currency', async () => {
    renderPage();
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).not.toMatch(/Spent|Left/);
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent(/2 figures hidden/i);
    expect(figures.textContent).toMatch(/\$/);
    expect(figures.textContent).not.toMatch(/IDR|Spent excludes/);
    expect(screen.queryByText('Amounts in IDR')).not.toBeInTheDocument();
  });

  it('with every category known, the cards equal the table totals in the project currency', async () => {
    state.rows = ROWS.map((r) => ({ ...r, actual: r.actual ?? 100 }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    expect(within(table).getByText('1,600')).toBeInTheDocument();
    expect(figures.textContent).toMatch(/Spent.*\$1,600/);
    expect(figures.textContent).toMatch(/Left.*\$4,400/);
  });
});
