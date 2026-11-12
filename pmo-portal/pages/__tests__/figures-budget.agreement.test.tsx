// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { budgetAgreementRoutes } from '@/src/test/figureAgreementRoutes';
import { renderFigureAgreementRoute } from '@/src/test/figureAgreementHarness';

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
    expect(primaryRow).toHaveTextContent('90%');
    // Spent remains a separate $500 reading (50% of the same $1,000 Active budget).
    expect(primaryRow).toHaveTextContent('$500');
  });

  // S04 flips this baseline red case after replacing the card's spend-only Budget used with PMO consumption.
  it.fails('Budget used agrees with the Active budget consumption on the real Projects card', async () => {
    const { container } = renderFigureAgreementRoute(cardRoute);
    await waitFor(() => expect(container.textContent).toContain('Budget used'));
    const observed = container.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    console.info(`FIGURE AGREEMENT RED · budget-used · Projects cards · expected 90% · observed screen: ${observed}`);
    expect(observed).toContain('90%');
  });
});
