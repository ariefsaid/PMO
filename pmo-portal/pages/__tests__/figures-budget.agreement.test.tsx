// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { budgetAgreementRoutes } from '@/src/test/figureAgreementRoutes';
import { renderFigureAgreementRoute } from '@/src/test/figureAgreementHarness';
import { setFigureAgreementBudgetPositionOverride } from '@/src/test/figureAgreementRepositoryMock';
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

afterEach(() => setFigureAgreementBudgetPositionOverride(undefined));

for (const route of budgetAgreementRoutes) {
  if (route.id === 'budget.projects.table' || route.id === 'budget.projects.cards') continue;
  it(`manifest mount: ${route.id}`, async () => {
    const { container } = renderFigureAgreementRoute(route);
    await waitFor(() => expect(container.textContent?.trim()).not.toBe(''));
  });
}

describe('S01 budget figure agreement on real screens', () => {
  it('smoke: the real Projects table renders PMO Budget used at 90%', async () => {
    renderFigureAgreementRoute(tableRoute);
    await waitFor(() => expect(screen.getByRole('row', { name: /S01 Primary Project/u })).toHaveTextContent('$500'));
    const primaryRow = screen.getByRole('row', { name: /S01 Primary Project/u });
    expect(primaryRow).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Budget used before tax/u })).toBeInTheDocument();
    expect(primaryRow).toHaveTextContent('90%');
    // Spent remains a separate $500 reading (50% of the same $1,000 Active budget).
    expect(primaryRow).toHaveTextContent('$500');
  });

  it('exports the same 90% number with the Budget used before tax header', () => {
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
    expect(budgetUsed?.header).toBe('Budget used before tax');
    expect(budgetUsed?.kind).toBe('percent');
    expect(budgetUsed?.exportValue?.(project)).toBe(90);
  });

  // S04 flips this baseline red case after replacing the card's spend-only Budget used with PMO consumption.
  it('Budget used agrees with the Active budget consumption on the real Projects card', async () => {
    const { container } = renderFigureAgreementRoute(cardRoute);
    await waitFor(() => expect(container.textContent).toContain('Budget used'));
    const observed = container.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    console.info(`FIGURE AGREEMENT RED · budget-used · Projects cards · expected 90% · observed screen: ${observed}`);
    expect(observed).toContain('90%');
  });

  it('keeps PM home and project header on the canonical 90% while showing spending separately at 50%', async () => {
    const home = renderFigureAgreementRoute(pmHomeRoute);
    await waitFor(() => expect(home.container.textContent).toContain('90%'));
    expect(home.container.textContent).toContain('Budget used before tax');
    home.unmount();

    const overview = renderFigureAgreementRoute(projectOverviewRoute);
    await waitFor(() => expect(overview.container.textContent).toContain('Budget used before tax'));
    expect(overview.container.textContent).toContain('90%');
    expect(overview.container.textContent).toContain('Spent (% of budget before tax)');
    expect(overview.container.textContent).toContain('50%');
    expect(overview.container.textContent).toContain('$500');
    expect(overview.container.textContent).toContain('Project spending is known; some category amounts are not mapped.');
  });

  it('keeps the project budget total known when category allocation is unknown', async () => {
    const { container } = renderFigureAgreementRoute(projectBudgetRoute);
    await waitFor(() => expect(container.textContent).toContain('Left after open orders'));
    expect(container.textContent).toContain('Budget used before tax');
    expect(container.textContent).toContain('90%');
    expect(container.textContent).toContain('Spent (% of budget before tax)');
    expect(container.textContent).toContain('50%');
    expect(container.textContent).toContain('$500');
    expect(container.textContent).toContain('$100');
    const laborRow = screen.getByRole('row', { name: /Labor/u });
    expect(laborRow).not.toHaveTextContent('$500');
  });

  it('uses ledger spending only for an ERP Budget used and left position', async () => {
    const erpPosition: CanonicalBudgetReading = {
      projectId: 'project-figure-primary', ledgerBasis: 'erp', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
      spent: '500.00', openCommitment: null, consumption: '500.00', complete: true, usedRatio: '0.5', usedPercent: '50',
      consumptionVariance: '-500.00', riskEligible: true, atRisk: false,
    };
    setFigureAgreementBudgetPositionOverride(erpPosition);
    const { container } = renderFigureAgreementRoute(projectBudgetRoute);
    await waitFor(() => expect(container.textContent).toContain('Left after spending'));
    expect(container.textContent).toContain('Budget used before tax');
    expect(container.textContent).toContain('50%');
    expect(container.textContent).toContain('$500');
    expect(container.textContent).not.toContain('Left after open orders');
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
