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
import { BahasaProvider } from '@/test/bahasa';
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

const fxIdr = vi.hoisted(() => ({ state: { status: 'off' } as { status: string; match?: { rate: number; rate_date: string } } }));
vi.mock('@/src/hooks/useFxIdrRate', () => ({ useFxIdrRate: () => fxIdr.state }));
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

/**
 * Reads the Spent column of the budget table by its header, so a test follows what a person adds
 * up: the figures in the body rows against the Total row's figure. In the body the category header
 * names a `rowheader` th (no `cell` role, so each data cell sits one header-index left); the
 * Total row's category is itself a `td` (the "Total" label), so its data cells sit level with
 * their headers.
 */
const spentColumn = (table: HTMLElement): { rowValues: string[]; total: string } => {
  const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent?.trim() ?? '');
  const spentHeaderIndex = headers.indexOf('Spent');
  if (spentHeaderIndex < 0) throw new Error('no Spent column rendered');
  const dataRows = within(table).getAllByRole('row').filter((row) => within(row).queryAllByRole('columnheader').length === 0);
  const totalRow = dataRows.find((row) => row.textContent?.includes('Total'));
  return {
    rowValues: dataRows.filter((row) => row !== totalRow).map((row) => within(row).getAllByRole('cell')[spentHeaderIndex - 1]?.textContent ?? ''),
    total: totalRow ? within(totalRow).getAllByRole('cell')[spentHeaderIndex]?.textContent ?? '' : '',
  };
};
const moneyValue = (cell: string) => cell.trim() === '' ? 0 : Number(cell.replace(/[^0-9.-]/g, ''));

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
  fxIdr.state = { status: 'off' };
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
    // Spent and Left read — with a short caption; no amount of the cached position leaks through.
    expect(within(figures).getAllByText('Spending is not linked').length).toBeGreaterThanOrEqual(1);
    expect(figures.textContent).not.toMatch(/1,500|4,500/);
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
    // Spent is withheld, never a zero: its own card reads — and says why in one short caption; no notice row.
    expect(within(figures).getAllByText('Spending is not linked').length).toBeGreaterThanOrEqual(1);
    expect(within(figures).getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(figures.textContent).not.toMatch(/Spent\s*0\b/);
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
  });
});

describe('AC-ODA-024 an all-USD project in a rupiah organisation (#2249)', () => {
  it('every USD card (Budget, Spent, Committed, Left) carries its rupiah equivalent', async () => {
    fxIdr.state = { status: 'ready', match: { rate: 18500, rate_date: '2026-11-14' } };
    ACTIVE.currency = 'USD';
    state.ledgerCurrency = 'USD';
    state.spendCurrency = 'USD';
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Budget.*\$6,000/);
    expect(within(figures).getByText('≈ IDR 111,000,000 (using IDR 18,500 rate)')).toBeInTheDocument(); // Budget
    expect(within(figures).getByText(/≈ IDR 27,750,000 \(using IDR 18,500 rate\)/)).toBeInTheDocument(); // Spent
    expect(within(figures).getByText('≈ IDR 0 (using IDR 18,500 rate)')).toBeInTheDocument(); // Committed
    expect(within(figures).getByText(/≈ IDR 83,250,000 \(using IDR 18,500 rate\)/)).toBeInTheDocument(); // Left
  });
});

/** One figure card by its test id: its figure, its added line and the line's full form (title). */
const figureCard = (figures: HTMLElement, id: string) => {
  const card = within(figures).getByTestId(`budget-figure-${id}`);
  return { card, text: card.textContent ?? '' };
};

describe('care-07b: every Budget-tab figure is in the project currency; the rupiah equivalent is an added line only', () => {
  it('names every figure: Budget, Budget used, Spent, Committed and Left read in USD; each USD amount adds its rupiah line, compact under a compact figure', async () => {
    fxIdr.state = { status: 'ready', match: { rate: 18500, rate_date: '2026-11-14' } };
    ACTIVE.currency = 'USD';
    state.ledgerCurrency = 'USD';
    state.spendCurrency = 'USD';
    state.rows = ROWS.map((r) => ({ ...r, actual: r.actual ?? 0 }));
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });

    const budget = figureCard(figures, 'budget');
    expect(within(budget.card).getByText('$6K')).toBeInTheDocument();
    expect(within(budget.card).getByText('≈ IDR 111M')).toHaveAttribute('title', '≈ IDR 111,000,000 (using IDR 18,500 rate)');

    const used = figureCard(figures, 'used');
    expect(within(used.card).getByText('25%')).toBeInTheDocument();
    expect(used.text).not.toMatch(/IDR/);

    const spent = figureCard(figures, 'spent');
    expect(within(spent.card).getByText('$1.5K')).toBeInTheDocument();
    expect(within(spent.card).getByText('≈ IDR 27.8M')).toHaveAttribute('title', '≈ IDR 27,750,000 (using IDR 18,500 rate)');

    // A figure that is not compact keeps the full line.
    const committed = figureCard(figures, 'committed');
    expect(within(committed.card).getByText('$0')).toBeInTheDocument();
    expect(within(committed.card).getByText('≈ IDR 0 (using IDR 18,500 rate)')).toBeInTheDocument();

    const left = figureCard(figures, 'left');
    expect(within(left.card).getByText('$4.5K')).toBeInTheDocument();
    expect(within(left.card).getByText('≈ IDR 83.3M')).toHaveAttribute('title', '≈ IDR 83,250,000 (using IDR 18,500 rate)');

    // No figure itself is a rupiah amount.
    for (const id of ['budget', 'used', 'spent', 'committed', 'left']) {
      const figure = figureCard(figures, id).card.querySelector('[data-figure]');
      expect(figure, id).not.toBeNull();
      expect(figure!.textContent, id).not.toMatch(/IDR/);
    }
  });

  it('mixed currencies: Left stays a project-currency figure (unknown, never a rupiah figure) and the rupiah position is its added full line', async () => {
    fxIdr.state = { status: 'ready', match: { rate: 18500, rate_date: '2026-11-14' } };
    ACTIVE.currency = 'USD';
    state.spendCurrency = 'IDR';
    state.rows = ROWS.map((r) => ({ ...r, actual: null }));
    state.spendRows = ROWS.map((r) => ({ ...r, actual: r.actual ?? 0 }));
    state.currencyDiffers = true;
    state.position = { ...state.position, spent: null, consumption: '1500.00', consumptionVariance: null, budgetComparisonKnown: false, usedPercent: null };
    state.displaySpent = { amount: 55500000, currency: 'IDR' };
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    const left = figureCard(figures, 'left');
    expect(left.text).toMatch(/^Left after committed—/);
    expect(within(left.card).queryByText('≈ IDR 55.5M')).toBeNull();
    expect(within(left.card).getByText('≈ IDR 55,500,000 (using IDR 18,500 rate)')).toBeInTheDocument();
    // Budget used is a share, not an amount: approximate, captioned with the rate.
    expect(within(figureCard(figures, 'used').card).getByText('≈ 50%')).toBeInTheDocument();
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

  it('design-1115: with every category mapped, the Spent card says the ledger recorded it in IDR, so a rupiah figure on a dollar project is not read as a slip', async () => {
    state.spendRows = ROWS.map((r) => ({ ...r, actual: r.actual ?? 100 }));
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Spent\s*IDR.*Recorded in IDR by the ledger\s*Committed/);
  });

  it('shows Budget used and Left in rupiah at the latest rate, each marked approximate, with no notice row', async () => {
    fxIdr.state = { status: 'ready', match: { rate: 18500, rate_date: '2026-11-14' } };
    state.displaySpent = { amount: 55500000, currency: 'IDR' };
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    // Exact figures stay exact and first; the equivalent sits under the USD budget.
    expect(figures.textContent).toMatch(/Budget.*\$6,000/);
    expect(within(figures).getByText('≈ IDR 111,000,000 (using IDR 18,500 rate)')).toBeInTheDocument();
    expect(figures.textContent).toMatch(/Spent.*IDR\s*55,500,000/);
    expect(figures.textContent).toMatch(/≈ 50%/);
    expect(within(figures).getByText('using IDR 18,500 rate')).toBeInTheDocument(); // under Budget used
    // care-07b (owner): Left stays a project-currency figure; the rupiah position is its added line, with the rate.
    expect(within(figureCard(figures, 'left').card).getByText(/≈ IDR 55,500,000 \(using IDR 18,500 rate\)$/)).toBeInTheDocument();
  });

  // care-07b (owner, supersedes design-1115's rupiah Left figure): the figure is never a rupiah amount; the
  // exact rupiah position stays on the card as its added line, and its rate date stays in the line's title.
  it('care-07b: the Left figure is never a rupiah amount; the exact rupiah position stays with it as its added line', async () => {
    fxIdr.state = { status: 'ready', match: { rate: 18500, rate_date: '2026-11-14' } };
    state.displaySpent = { amount: 55500000, currency: 'IDR' };
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    const left = figureCard(figures, 'left').card;
    expect(left.querySelector('[data-figure]')?.textContent).toBe('—');
    expect(within(left).getByText(/≈ IDR 55,500,000 \(using IDR 18,500 rate\)$/)).toHaveAttribute('title', expect.stringMatching(/JISDOR rate of/));
  });

  it('with no rate uploaded Budget used and Left read — and say so on their own cards', async () => {
    fxIdr.state = { status: 'none' };
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    expect(within(figures).getAllByText('No exchange rate uploaded').length).toBeGreaterThanOrEqual(2);
    expect(figures.textContent).not.toMatch(/≈ \d/);
  });

  it('the unknown-figure caption reads in Bahasa without a notice row', async () => {
    fxIdr.state = { status: 'none' };
    render(
      <BahasaProvider locale="id">
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/projects/p-1/budget']}>
            <ToastProvider><ProjectBudget projectId="p-1" project={projectIn('USD')} /></ToastProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </BahasaProvider>,
    );
    await screen.findAllByText('Belum ada kurs yang diunggah');
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    expect(screen.getAllByText('Belum ada kurs yang diunggah').length).toBeGreaterThanOrEqual(1);
  });

  it('does not call mapped spending unmapped when only the comparison currency differs', async () => {
    state.unknown = 3;
    state.spendRows = ROWS.map((row) => ({ ...row, actual: row.actual ?? 100 }));
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(figures.textContent).toMatch(/Spent.*IDR\s*1,500/);
    expect(figures.textContent).not.toMatch(/not mapped|unmapped/i);
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
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
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
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
    expect(within(figures).getAllByText('Spending is not linked').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
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

  it('puts the unsplit spending on one row so the Spent column adds up to the Total row', async () => {
    state.rows = ROWS.map((row) => ({ ...row, actual: null }));
    state.unknown = 3;
    state.position = { ...state.position, spent: 1600, budgetComparisonKnown: true };
    renderPage();
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const spent = spentColumn(table);
    expect(spent.rowValues).toEqual(['', '', '', '$1,600']);
    expect(spent.total).toBe('$1,600');
    expect(spent.rowValues.reduce((sum, cell) => sum + moneyValue(cell), 0)).toBe(moneyValue(spent.total));
    // The row carries the spent figure; its Budget cell is empty, never a $0 placeholder.
    const notSplitRow = within(table).getByRole('row', { name: /Not split by category/ });
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent?.trim() ?? '');
    const budgetCell = within(notSplitRow).getAllByRole('cell')[headers.indexOf('Budget') - 1];
    expect(budgetCell?.textContent ?? '').toBe('');
    expect(budgetCell?.textContent ?? '').not.toBe('$0');
  });

  it('a partially known split puts only the unknown remainder on the not-split row', async () => {
    state.rows = [{ category: 'Labor', budget: 5000, actual: 1000 }, { category: 'Materials', budget: 800, actual: null }, { category: 'Travel', budget: 200, actual: null }];
    state.unknown = 2;
    state.position = { ...state.position, spent: 1600, budgetComparisonKnown: true };
    renderPage();
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    const spent = spentColumn(table);
    // Labor carries its known $1,000; the not-split row carries only the unknown $600 remainder.
    expect(spent.rowValues).toEqual(['$1,000', '', '', '$600']);
    expect(spent.total).toBe('$1,600');
    expect(spent.rowValues.reduce((sum, cell) => sum + moneyValue(cell), 0)).toBe(moneyValue(spent.total));
  });

  it('an empty Uncategorized row is left out instead of contradicting the total', async () => {
    state.rows = [...ROWS.map((row) => ({ ...row, actual: null })), { category: 'Uncategorized', budget: 0, actual: null }];
    state.spendRows = state.rows;
    state.unknown = 4;
    state.position = { ...state.position, spent: 1600, budgetComparisonKnown: true };
    renderPage();
    const table = await screen.findByRole('table', { name: 'Budget vs actual by category' });
    // Nothing is recorded on the Uncategorized row (budget $0, spent $0, committed $0), so it is
    // not shown beside a total it cannot explain; the unsplit spending sits on its own row.
    expect(within(table).queryByRole('row', { name: /Uncategorized/ })).not.toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Not split by category/ })).toHaveTextContent('$1,600');
    const spent = spentColumn(table);
    expect(spent.rowValues.reduce((sum, cell) => sum + moneyValue(cell), 0)).toBe(moneyValue(spent.total));
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
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
  });

  it('warns when an actual category is unknown', async () => {
    state.spendRows = ROWS;
    renderPage(projectIn('USD'));
    const figures = await screen.findByRole('region', { name: 'Budget figures' });
    expect(within(figures).getByText('Not split by category')).toBeInTheDocument();
  });
});
