// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { billingAgreementRoutes } from '@/src/test/figureAgreementRoutes';
import { renderFigureAgreementRoute } from '@/src/test/figureAgreementHarness';
import { setFigureAgreementSingleCurrencyContractCase } from '@/src/test/figureAgreementRepositoryMock';

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
const homeRoute = billingAgreementRoutes.find((route) => route.id === 'billing.home.executive.overview')!;

for (const route of billingAgreementRoutes) {
  if (route.id === 'billing.project.contract' || route.id === 'billing.reports') continue;
  it(`manifest mount: ${route.id}`, async () => {
    const { container } = renderFigureAgreementRoute(route);
    await waitFor(() => expect(container.textContent?.trim()).not.toBe(''));
  });
}

describe('S02 billed-work figure agreement on real screens', () => {
  afterEach(() => setFigureAgreementSingleCurrencyContractCase(false));
  it('Reports shows selected-period, cumulative, and opening billed work as distinct figures', async () => {
    const user = userEvent.setup();
    const { container } = renderFigureAgreementRoute(reportRoute);
    const figures = await screen.findByRole('region', { name: 'Report figures' });
    await waitFor(() => expect(figures.textContent).toMatch(/Billed work in period\s*\$110/u));
    expect(figures.textContent).toMatch(/Billed work in period\s*\$110/u);
    expect(figures.textContent).toMatch(/Invoiced to date\s*\$150/u);
    expect(figures.textContent).toMatch(/Opening billed work\s*\$40/u);
    expect(screen.getByRole('columnheader', { name: 'Invoiced' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show monthly totals/u }));
    await waitFor(() => expect(container.textContent).toContain('Nov 2026'));
    expect(container.textContent).toMatch(/110/u);
    expect(within(screen.getByRole('table', { name: 'Monthly totals' })).getByRole('columnheader', { name: 'Invoiced' })).toBeInTheDocument();
  });

  it('home and Reports agree when both use the same selected month', async () => {
    const home = renderFigureAgreementRoute({
      ...homeRoute,
      location: '/?period=custom&from=2026-11&to=2026-11',
    });
    const homeFigures = await screen.findByRole('region', { name: 'Company figures' });
    await waitFor(() => expect(homeFigures.textContent).toMatch(/Invoiced\s*\$110/u));
    const homeAmount = homeFigures.textContent?.match(/Invoiced\s*(\$[\d,.]+)/u)?.[1];
    home.unmount();

    renderFigureAgreementRoute(reportRoute);
    const reportFigures = await screen.findByRole('region', { name: 'Report figures' });
    await waitFor(() => expect(reportFigures.textContent).toMatch(/Billed work in period\s*\$110/u));
    const reportAmount = within(reportFigures).getByText('Billed work in period').parentElement?.parentElement?.textContent?.match(/\$[\d,.]+/u)?.[0];

    expect(homeAmount).toBe('$110');
    expect(reportAmount).toBe(homeAmount);
  });

  it('contract invoiced is unavailable when the agreement fixture includes a foreign-currency Contract invoice', async () => {
    renderFigureAgreementRoute(contractRoute);
    const invoicedStep = await screen.findByRole('listitem', { name: /^Invoiced /u }, { timeout: 10_000 });
    expect(invoicedStep).toHaveTextContent('—');
    expect(invoicedStep).not.toHaveTextContent('$100');
    expect(invoicedStep).not.toHaveTextContent('$0');
    expect(invoicedStep).toHaveTextContent('Signed contract · excluding tax');
  });

  it('contract invoiced is $100 and 10% for a single-currency Contract invoice set', async () => {
    setFigureAgreementSingleCurrencyContractCase(true);
    renderFigureAgreementRoute(contractRoute);
    const invoicedStep = await screen.findByRole('listitem', { name: /^Invoiced /u }, { timeout: 10_000 });
    expect(invoicedStep).toHaveTextContent('$100');
    expect(invoicedStep).toHaveTextContent('Signed contract · excluding tax');
    expect(invoicedStep).toHaveTextContent('10%');
  });
});
