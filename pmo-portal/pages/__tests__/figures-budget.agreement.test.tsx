// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { budgetAgreementRoutes } from '@/src/test/figureAgreementRoutes';
import { renderFigureAgreementRoute } from '@/src/test/figureAgreementHarness';
import { setFigureAgreementBudgetPositionOverride, setFigureAgreementProcurementOverride } from '@/src/test/figureAgreementRepositoryMock';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { figureAgreementFixture } from '@/src/test/fixtures/figureAgreement';
import { projectTableColumns } from '../projects/projectTableColumns';
import type { TFunction } from 'i18next';

vi.unmock('@/src/hooks/useProjectsMoneyCollection');

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: globalThis.__figureAgreementAuth?.session ?? null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: globalThis.__figureAgreementAuth?.profile ?? null, error: null }) }) }) }),
  },
}));

vi.mock('@/src/lib/i18n/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/i18n/index')>();
  return { ...actual, initI18n: async () => actual.i18next };
});

vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  const { createFigureAgreementRepositoryModule } = await import('@/src/test/figureAgreementRepositoryMock');
  return createFigureAgreementRepositoryModule(actual as unknown as { repositories: Record<string, unknown> });
});

const tableRoute = budgetAgreementRoutes.find((route) => route.id === 'budget.projects.table')!;
const cardRoute = budgetAgreementRoutes.find((route) => route.id === 'budget.projects.cards')!;
const pmHomeRoute = budgetAgreementRoutes.find((route) => route.id === 'budget.home.pm')!;
const projectOverviewRoute = budgetAgreementRoutes.find((route) => route.id === 'budget.project.overview')!;
const projectBudgetRoute = budgetAgreementRoutes.find((route) => route.id === 'budget.project.budget')!;

const renderBudgetAgreementRoute = async () => {
  // ProjectDetail's budget tab is a lazy chunk; match the project's own harness so a
  // parallel test run cannot assert against Suspense's temporary "Loading…" fallback.
  await import('../project-detail/tabs/BudgetTab');
  return renderFigureAgreementRoute(projectBudgetRoute);
};

afterEach(() => { setFigureAgreementBudgetPositionOverride(undefined); setFigureAgreementProcurementOverride(undefined); });

for (const route of budgetAgreementRoutes) {
  if (route.id === 'budget.projects.table' || route.id === 'budget.projects.cards') continue;
  it(`manifest mount: ${route.id}`, async () => {
    const { container } = renderFigureAgreementRoute(route);
    await waitFor(() => expect(container.textContent?.trim()).not.toBe(''));
  });
}

describe('S01 budget figure agreement on real screens', () => {
  it('smoke: the real Projects table renders PMO Budget used at 50%', async () => {
    renderFigureAgreementRoute(tableRoute);
    await waitFor(() => expect(screen.getByRole('row', { name: /S01 Primary Project/u })).toHaveTextContent('$500'));
    const primaryRow = screen.getByRole('row', { name: /S01 Primary Project/u });
    expect(primaryRow).toBeInTheDocument();
    const header = screen.getByRole('columnheader', { name: /Budget used/u });
    expect(header).toBeInTheDocument();
    expect(header.querySelector('[title]')).toHaveAttribute('title', 'Spent as a share of budget, before tax');
    expect(primaryRow).toHaveTextContent('50%');
    // Spent remains a separate $500 reading (50% of the same $1,000 Active budget).
    expect(primaryRow).toHaveTextContent('$500');
  });

  it('exports the same 50% number with the Budget used header', () => {
    const project = figureAgreementFixture.projects.primary as unknown as ProjectWithRefs;
    const budgetPosition: CanonicalBudgetReading = {
      projectId: project.id, ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: '500.00', openCommitment: '400.00', consumption: '900.00', complete: true, usedRatio: '0.9', usedPercent: '90',
      consumptionVariance: '-100.00', riskEligible: true, atRisk: true,
    };
    const money: ProjectMoneyRead = {
      ledgerBasis: 'pmo',
      actuals: { currency: 'USD', total: '500.00', asOf: null, excludesRestrictedRows: false, complete: true, categories: [] },
      activeBudgetAmount: '1000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true, budgetPosition,
    };
    const { exportColumns } = projectTableColumns({
      filtered: [project], deliverySummary: {}, deliveryPending: false, deliveryError: false,
      projectMoney: { [project.id]: money }, moneyPending: false, moneyError: false, canViewMoney: true,
      viewerId: null, isAtRiskActual: () => true, onOpen: vi.fn(), t: ((_key: string, fallback: string) => fallback) as unknown as TFunction,
    });
    const budgetUsed = exportColumns.find((column) => column.key === 'budget-used');
    expect(budgetUsed?.header).toBe('Budget used');
    expect(budgetUsed?.kind).toBe('percent');
    expect(budgetUsed?.exportValue?.(project)).toBe(50);
  });

  // The real card must agree with spending, including when orders exist.
  it('Budget used agrees with the Active budget consumption on the real Projects card', async () => {
    const { container } = renderFigureAgreementRoute(cardRoute);
    await waitFor(() => expect(container.textContent).toContain('Budget used'));
    const observed = container.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    console.info(`FIGURE AGREEMENT RED · budget-used · Projects cards · expected 50% · observed screen: ${observed}`);
    expect(observed).toContain('50%');
  });

  it('keeps PM home and project header on the canonical 50% while showing spending separately at 50%', async () => {
    const home = renderFigureAgreementRoute(pmHomeRoute);
    await waitFor(() => expect(home.container.textContent).toContain('Budget used'));
    expect(home.container.textContent).toContain('50%');
    const budgetHelp = home.container.querySelector('[title="Spent as a share of budget, before tax"]');
    expect(budgetHelp).toBeInTheDocument();
    expect(budgetHelp?.closest('[aria-hidden="true"]')).toBeNull();
    home.unmount();

    const overview = renderFigureAgreementRoute(projectOverviewRoute);
    await waitFor(() => expect(overview.container.textContent).toContain('Budget used'));
    await waitFor(() => expect(overview.container.querySelector('[data-testid="project-budget-figures"]')).toHaveTextContent('50%'));
    expect(overview.container.textContent).not.toContain('Spent (% of budget before tax)');
    expect(overview.container.textContent).toContain('Committed open orders');
    expect(overview.container.textContent).toContain('Left after orders');
    expect(overview.container.textContent).toContain('50%');
    expect(overview.container.textContent).toContain('$500');
    expect(overview.container.textContent).toContain('Project spending is known; some category amounts are not mapped.');
  });

  it('keeps the project budget total known when category allocation is unknown', async () => {
    const { container } = await renderBudgetAgreementRoute();
    await waitFor(() => expect(container.textContent).toContain('Left after open orders'));
    expect(container.textContent).toContain('Budget used');
    expect(container.textContent).toContain('50%');
    expect(container.textContent).not.toContain('Spent (% of budget before tax)');
    expect(container.textContent).toContain('50%');
    expect(container.textContent).toContain('$500');
    expect(container.textContent).toContain('$100');
    const tiles = screen.getByRole('region', { name: 'Budget figures' });
    expect(tiles).toHaveTextContent(/Budget.*Budget used.*Spent.*Committed.*Left after open orders/u);
    expect(screen.getByRole('columnheader', { name: 'Left after spending' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '% used' })).toBeInTheDocument();
    const laborRow = screen.getByRole('row', { name: /Labor/u });
    expect(laborRow).not.toHaveTextContent('$500');
  });

  it('shows an unknown budget-used reading as unknown, never zero', async () => {
    setFigureAgreementBudgetPositionOverride({
      projectId: 'project-figure-primary', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: null, openCommitment: null, consumption: null, complete: false, usedRatio: null, usedPercent: null,
      consumptionVariance: null, riskEligible: false, atRisk: null,
    });
    const { container } = await renderBudgetAgreementRoute();
    await waitFor(() => expect(container.textContent).toContain('Budget used is unknown or unavailable.'));
    expect(container.textContent).not.toMatch(/Budget used\s*0%/u);
    expect(container.textContent).not.toMatch(/Budget used\s*0(?:\.0+)?% of/u);
  });

  it('uses ledger spending only for an ERP Budget used and left position', async () => {
    const erpPosition: CanonicalBudgetReading = {
      projectId: 'project-figure-primary', ledgerBasis: 'erp', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: '500.00', openCommitment: null, consumption: '500.00', complete: true, usedRatio: '0.5', usedPercent: '50',
      consumptionVariance: '-500.00', riskEligible: true, atRisk: false,
    };
    setFigureAgreementBudgetPositionOverride(erpPosition);
    const { container } = await renderBudgetAgreementRoute();
    await waitFor(() => expect(container.textContent).toContain('Left after spending'));
    expect(container.textContent).toContain('Budget used');
    expect(container.textContent).toContain('50%');
    expect(container.textContent).toContain('$500');
    expect(container.textContent).toContain('Left after open orders');
  });


  for (const route of [tableRoute, cardRoute, pmHomeRoute, projectOverviewRoute, projectBudgetRoute]) {
    it.each([
      ['with orders', '400.00', '900.00', '-100.00'],
      ['without orders', '0.00', '500.00', '-500.00'],
    ])(`shows spending as budget used on ${route.id}: %s`, async (_case, commitment, consumption, variance) => {
      setFigureAgreementBudgetPositionOverride({
        projectId: 'project-figure-primary', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
        spent: '500.00', openCommitment: commitment, consumption, complete: true,
        usedRatio: commitment === '0.00' ? '0.5' : '0.9', usedPercent: commitment === '0.00' ? '50' : '90',
        consumptionVariance: variance, riskEligible: false, atRisk: false,
      });
      const view = route === projectBudgetRoute ? await renderBudgetAgreementRoute() : renderFigureAgreementRoute(route);
      await waitFor(() => expect(view.container.textContent).toContain('Budget used'));
      await waitFor(() => { if (route === projectBudgetRoute) expect(view.container.querySelector('[aria-label="Budget figures"]')).toBeInTheDocument(); });
      const surface = route === projectOverviewRoute
        ? view.container.querySelector('[data-testid="project-budget-figures"]')
        : route === projectBudgetRoute
          ? view.container.querySelector('[aria-label="Budget figures"]')
          : route === tableRoute ? screen.getByRole('row', { name: /S01 Primary Project/u }) : view.container;
      await waitFor(() => expect(surface).toHaveTextContent('50%'));
      expect(surface).not.toHaveTextContent('90%');
      view.unmount();
    });
  }

  it('keeps unknown spending unknown on the list, header, overview and budget', async () => {
    setFigureAgreementBudgetPositionOverride({
      projectId: 'project-figure-primary', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: null, openCommitment: null, consumption: null, complete: false,
      usedRatio: null, usedPercent: null, consumptionVariance: null, riskEligible: false, atRisk: null,
    });
    const list = renderFigureAgreementRoute(tableRoute);
    await screen.findByRole('row', { name: /S01 Primary Project/u });
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Budget used/u })).not.toBeInTheDocument());
    expect(screen.getByRole('row', { name: /S01 Primary Project/u }).querySelector('[aria-label*="budget"]')).toBeNull();
    list.unmount();
    const cards = renderFigureAgreementRoute(cardRoute);
    await screen.findByText('S01 Primary Project');
    await waitFor(() => expect(cards.container).toHaveTextContent('Some project financial figures are still being confirmed.'));
    expect(cards.container).not.toHaveTextContent(/Budget used\s*\d+(?:\.\d+)?%/u);
    cards.unmount();
    const home = renderFigureAgreementRoute(pmHomeRoute);
    await screen.findAllByText('S01 Primary Project');
    await waitFor(() => expect(home.container).not.toHaveTextContent('Checking budget use…'));
    expect(home.container).not.toHaveTextContent(/Budget used\s*\d+(?:\.\d+)?%/u);
    home.unmount();
    const overview = renderFigureAgreementRoute(projectOverviewRoute);
    await waitFor(() => expect(overview.container.querySelector('[data-testid="project-budget-figures"]')).toHaveTextContent('Budget used —'));
    expect(overview.container.querySelector('[data-testid="project-budget-figures"]')).not.toHaveTextContent('0%');
    overview.unmount();
    const budget = await renderBudgetAgreementRoute();
    await waitFor(() => expect(budget.container.textContent).toContain('Budget used is unknown or unavailable.'));
    expect(budget.container.textContent).not.toMatch(/Budget used\s*0%/u);
    budget.unmount();
  });

  it('shows spending and the position after open orders on two budget card lines', async () => {
    const view = renderFigureAgreementRoute(projectOverviewRoute);
    const card = await waitFor(() => {
      const node = view.container.querySelector('section[aria-labelledby="pd-cost"]');
      expect(node).toHaveTextContent('Committed open orders');
      return node!;
    });
    expect(card).toHaveTextContent('Spent $500 of $1,000');
    expect(card).not.toHaveTextContent('50% used');
    expect(card).toHaveTextContent('Committed open orders $400 · Left after orders $100');
  });

  it('names unknown open orders without inventing a remainder', async () => {
    setFigureAgreementProcurementOverride([{ id: 'unknown-order', status: 'Ordered', budget_category: 'Labor', currency: 'USD', open_commitment: null, approved_total_value: null, total_value: null }]);
    setFigureAgreementBudgetPositionOverride({
      projectId: 'project-figure-primary', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: '500.00', openCommitment: null, consumption: null, complete: false,
      usedRatio: null, usedPercent: null, consumptionVariance: null, riskEligible: false, atRisk: null,
    });
    const view = renderFigureAgreementRoute(projectOverviewRoute);
    await waitFor(() => expect(view.container.querySelector('section[aria-labelledby="pd-cost"]')).toHaveTextContent('Open orders are unknown'));
    expect(view.container.querySelector('section[aria-labelledby="pd-cost"]')).not.toHaveTextContent(/Left after open orders \$[\d,]+/u);
  });

  it.each([
    ['with orders', 400, '$400', '$100'],
    ['without orders', 0, '$0', '$500'],
    ['orders unknown', null, 'Open orders are unknown', null],
  ])('agrees on ERP commitments and remaining on overview and budget: %s', async (_case, amount, committed, left) => {
    setFigureAgreementBudgetPositionOverride({
      projectId: 'project-figure-primary', ledgerBasis: 'erp', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: '500.00', openCommitment: null, consumption: '500.00', complete: true,
      usedRatio: '0.5', usedPercent: '50', consumptionVariance: '-500.00', riskEligible: true, atRisk: false,
    });
    setFigureAgreementProcurementOverride([{ id: 'order-1', status: 'Ordered', budget_category: 'Labor', currency: 'USD', open_commitment: amount, approved_total_value: amount, total_value: amount }]);
    const overview = renderFigureAgreementRoute(projectOverviewRoute);
    const card = () => overview.container.querySelector('section[aria-labelledby="pd-cost"]');
    await waitFor(() => expect(card()).toHaveTextContent(committed));
    if (left === null) expect(card()).toHaveTextContent('Left after open orders is unknown');
    else expect(card()).toHaveTextContent(`Left after orders ${left}`);
    overview.unmount();
    const budget = await renderBudgetAgreementRoute();
    const tiles = await screen.findByRole('region', { name: 'Budget figures' });
    if (left === null) await waitFor(() => expect(budget.container).toHaveTextContent('Commitments are unknown or unavailable.'));
    else { await waitFor(() => expect(tiles).toHaveTextContent('Left after open orders')); expect(tiles).toHaveTextContent(left); expect(tiles).toHaveTextContent(committed); }
    budget.unmount();
  });

  it.each([
    ['budget', null, '500.00', 'Budget is unavailable for comparison'],
    ['spending', '1000.00', null, 'Spending is unavailable'],
  ])('names unavailable %s on Overview and Budget without a remainder', async (_case, budgetAmount, spent, reason) => {
    setFigureAgreementBudgetPositionOverride({
      projectId: 'project-figure-primary', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: budgetAmount,
      spent, openCommitment: '400.00', consumption: null, complete: false,
      usedRatio: null, usedPercent: null, consumptionVariance: null, riskEligible: false, atRisk: null,
    });
    const overview = renderFigureAgreementRoute(projectOverviewRoute);
    const card = () => overview.container.querySelector('section[aria-labelledby="pd-cost"]');
    await waitFor(() => expect(card()).toHaveTextContent(reason));
    expect(card()).not.toHaveTextContent(/Left after open orders \$[\d,]+/u);
    overview.unmount();
    const budget = await renderBudgetAgreementRoute();
    const expected = spent === null ? 'Spending is unknown or unavailable.' : 'Budget is unavailable for comparison';
    await waitFor(() => expect(budget.container).toHaveTextContent(expected));
    expect(budget.container).not.toHaveTextContent(/Left after open orders\s*\$[\d,]+/u);
    budget.unmount();
  });

  it('names every missing input when budget, spending and orders are all unknown', async () => {
    setFigureAgreementProcurementOverride([{ id: 'unknown-order', status: 'Ordered', budget_category: 'Labor', currency: 'USD', open_commitment: null, approved_total_value: null, total_value: null }]);
    setFigureAgreementBudgetPositionOverride({
      projectId: 'project-figure-primary', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: null,
      spent: null, openCommitment: null, consumption: null, complete: false,
      usedRatio: null, usedPercent: null, consumptionVariance: null, riskEligible: false, atRisk: null,
    });
    const overview = renderFigureAgreementRoute(projectOverviewRoute);
    const card = () => overview.container.querySelector('section[aria-labelledby="pd-cost"]');
    await waitFor(() => expect(card()).toHaveTextContent('Budget is unavailable for comparison'));
    expect(card()).toHaveTextContent('Spending is unavailable');
    expect(card()).toHaveTextContent('Open orders are unknown');
    expect(card()).not.toHaveTextContent(/Left after open orders \$[\d,]+/u);
    overview.unmount();
    const budget = await renderBudgetAgreementRoute();
    await waitFor(() => expect(budget.container).toHaveTextContent('Budget is unavailable for comparison'));
    expect(budget.container).toHaveTextContent(/spending (?:is|isn.t)/iu);
    expect(budget.container).toHaveTextContent(/commitments (?:are|is)/iu);
    expect(budget.container).not.toHaveTextContent(/Left after open orders\s*\$[\d,]+/u);
    budget.unmount();
  });

  it('names the spending overrun and the overrun after open orders as separate measures', async () => {
    const overrun: CanonicalBudgetReading = {
      projectId: 'project-figure-primary', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: '1100.00', openCommitment: '400.00', consumption: '1500.00', complete: true, usedRatio: '1.5', usedPercent: '150',
      consumptionVariance: '500.00', riskEligible: true, atRisk: true,
    };
    setFigureAgreementBudgetPositionOverride(overrun);
    const { container } = renderFigureAgreementRoute(projectOverviewRoute);
    await waitFor(() => expect(container.textContent).toContain('100 over on spending'));
    expect(container.textContent).toContain('500 over after open orders');
    expect(container.textContent).not.toContain('500 over budget');
  });
});
