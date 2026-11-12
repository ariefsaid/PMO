// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { billingAgreementRoutes } from '@/src/test/figureAgreementRoutes';
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

const contractRoute = billingAgreementRoutes.find((route) => route.id === 'billing.project.contract')!;
const reportRoute = billingAgreementRoutes.find((route) => route.id === 'billing.reports')!;

for (const route of billingAgreementRoutes) {
  if (route.id === 'billing.project.contract' || route.id === 'billing.reports') continue;
  it(`manifest mount: ${route.id}`, async () => {
    const { container } = renderFigureAgreementRoute(route);
    await waitFor(() => expect(container.textContent?.trim()).not.toBe(''));
  });
}

describe('S01 invoiced figure agreement on real screens', () => {
  it('smoke: Reports keeps cumulative and selected-period billed work labelled separately', async () => {
    const user = userEvent.setup();
    const { container } = renderFigureAgreementRoute(reportRoute);
    await waitFor(() => expect(container.textContent).toContain('Invoiced to date'));
    await waitFor(() => expect(container.textContent).toMatch(/150/u));
    await user.click(screen.getByRole('button', { name: /Show monthly totals/u }));
    await waitFor(() => expect(container.textContent).toContain('Nov 2026'));
    expect(container.textContent).toMatch(/110/u);
    expect(container.textContent).toContain('Invoiced to date');
  });

  // S02 flips this baseline red case after replacing the Contract tab's all-kind, unfiltered invoice sum with the contract-kind,
  // project-currency reading already exposed by Project finances.
  it.fails('contract invoiced agrees with the independently pinned USD contract-kind total', async () => {
    renderFigureAgreementRoute(contractRoute);
    let observed = '';
    await waitFor(() => {
      const invoicedStep = screen.getByRole('listitem', { name: /^Invoiced /u });
      observed = invoicedStep.getAttribute('aria-label') ?? '';
      expect(observed).not.toBe('');
    });
    console.info(`FIGURE AGREEMENT RED · contract-invoiced · ProjectDetail Contract tab · expected USD $100 · observed ${observed}`);
    expect(observed).toContain('$100');
  });
});
