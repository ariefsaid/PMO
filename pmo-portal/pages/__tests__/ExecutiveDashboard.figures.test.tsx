/**
 * Ported from the pre-restructure ExecutiveDashboard.test.tsx (baseline fa511c382): the money oracles —
 * contract value, billed-work margin, weighted pipeline, foreign-currency naming, forecast margin and the
 * win-rate basis / period — asserted through the REAL company figures hook on the real dashboard page.
 * Only the data sources are stubbed (pages/ExecutiveDashboard.test.tsx stubs the figures themselves).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';

const populated = {
  active_projects: 2,
  active_delivery_projects: 2,
  risk_unchecked_projects: 0,
  total_contract_value: 8_000_000,
  on_hand_margin: 0.949375,
  on_hand_value: 8_000_000 as number | null,
  on_hand_contract_remaining: 7_595_000 as number | null,
  on_hand_realized_margin: 1_200_000 as number | null,
  on_hand_actual_known: 4_000_000,
  on_hand_actual_project_count: 2,
  on_hand_actual_project_total: 2,
  on_hand_actual_coverage_count: 2,
  on_hand_actual_coverage_total: 2,
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8_000_000, actual_known: 4_000_000, contract_remaining: 7_595_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 1_200_000, unknown_projects: 0 }],
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 1_200_000, unknown_projects: 0 }],
  pipeline_weighted_value: 800_000 as number | null,
  pipeline_projected_margin: 0.2 as number | null,
  pipeline_total_value: 2_000_000,
  pipeline_total_value_by_currency: [{ currency: 'USD', total_value: 2_000_000, weighted_value: 800_000, forecast_margin: 0.2, no_active_budget: 0 }] as unknown[],
  projects_at_risk: 1,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [],
  top_projects: [],
};
const winRateOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8_000_000, losses_value: 650_000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
  value_by_currency: [{ currency: 'USD', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 }],
};

const h = vi.hoisted(() => ({
  dash: null as unknown,
  orgCurrency: 'USD',
  winRateKeys: [] as string[],
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/components/dashboard/restructure/useNeedsYou')>()),
  useNeedsYou: () => ({ items: [], areaItems: [], pmOverdueTasksByProject: {}, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => h.orgCurrency,
  useOrgCurrencyState: () => ({ currency: h.orgCurrency, isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: { totals: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: h.dash, isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: (range: { key: string }) => {
    h.winRateKeys.push(range.key);
    return { data: winRateOracle, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));

import ExecutiveDashboard from '../ExecutiveDashboard';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ToastProvider><ExecutiveDashboard /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

const figures = () => screen.getByRole('region', { name: 'Company figures' });
const tile = (label: string) => {
  const element = within(figures()).getByText(label, { exact: true }).parentElement?.parentElement?.parentElement;
  expect(element).toBeTruthy();
  return element as HTMLElement;
};

beforeEach(() => {
  h.dash = { ...populated };
  h.orgCurrency = 'USD';
  h.winRateKeys = [];
});

describe('company figures — ported money oracles', () => {
  it('AC-701: contract on hand is the $8,000,000 delivery contract — short on the tile, exact on hover and for screen readers', () => {
    renderPage();
    const contract = tile('Contract on hand');
    expect(contract).toHaveTextContent('$8M');
    expect(contract.querySelector('[title="$8,000,000"]')).not.toBeNull();
    expect(within(contract).getByText('$8,000,000')).toHaveClass('sr-only');
  });

  it('AC-1114 / AC-UX-017: billed-work margin is the margin amount, never the contract remainder dressed as profit', () => {
    renderPage();
    const margin = tile('Margin on billed work');
    expect(margin).toHaveTextContent('$1.2M');
    expect(margin.querySelector('[title="$1,200,000"]')).not.toBeNull();
    // 94.9% is (contract − spend) / contract — the old false-profit figure; the remainder is $7.6M.
    expect(margin).not.toHaveTextContent('94.9%');
    expect(margin).not.toHaveTextContent('$7.6M');
    expect(tile('Contract on hand')).toHaveTextContent('Left after spending: $7.6M');
  });

  it('AC-1114: the weighted pipeline shows short $800K with the exact $800,000 kept', () => {
    renderPage();
    const pipeline = tile('Pipeline (weighted)');
    expect(pipeline).toHaveTextContent('$800K');
    expect(pipeline.querySelector('[title="$800,000"]')).not.toBeNull();
  });

  it('AC-IXD-DASH-002: forecast margin is the one weighted-pipeline percentage, with no on-hand/weighted lens toggle', () => {
    renderPage();
    expect(within(figures()).getAllByText(/Forecast margin/)).toHaveLength(1);
    expect(tile('Pipeline (weighted)')).toHaveTextContent('Forecast margin: 20.0%');
    expect(screen.queryByRole('tab', { name: /Weighted/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /On-hand/i })).toBeNull();
  });

  it('SL-B / AC-RD-UNAVAIL-001: an uncomputable forecast margin and weighted value show no margin and an explained figure, never prose', () => {
    h.dash = { ...populated, pipeline_projected_margin: null, pipeline_weighted_value: null, pipeline_total_value: 0, pipeline_total_value_by_currency: [] };
    renderPage();
    expect(screen.queryByText(/Forecast margin/)).not.toBeInTheDocument();
    const pipeline = tile('Pipeline (weighted)');
    const unavailable = within(pipeline).getByRole('status');
    expect(unavailable).toHaveTextContent('The accounting source did not provide a comparable amount.');
    expect(unavailable).not.toHaveTextContent(/\$|\d/);
  });

  it('AC-RD-MONEY-003: in an IDR org a USD on-hand row names its currency by code, never a bare "$"', () => {
    h.orgCurrency = 'IDR';
    h.dash = {
      ...populated,
      on_hand_value: null,
      on_hand_value_by_currency: [
        { currency: 'IDR', contract_value: 373_500_000_000, actual_known: 0, contract_remaining: 0, actual_coverage_count: 1, actual_coverage_total: 1, realized_margin_known: 0, unknown_projects: 0 },
        { currency: 'USD', contract_value: 3_400_000, actual_known: 0, contract_remaining: 0, actual_coverage_count: 1, actual_coverage_total: 1, realized_margin_known: 0, unknown_projects: 0 },
      ],
    };
    renderPage();
    const contract = tile('Contract on hand');
    expect(contract).toHaveTextContent('USD 3.4M');
    expect(contract).not.toHaveTextContent(/\$3\.4M/);
  });
});

describe('company win rate — ported AC-1115 / FR-SPD-013', () => {
  it('AC-1115: the win-rate card toggles count ↔ value and the page period re-queries it with a new range', () => {
    renderPage();
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(within(screen.getByTestId('win-rate-currency-USD')).getByRole('progressbar', { name: /USD win rate on decided bids/i }))
      .toHaveAttribute('aria-valuetext', '92.5%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');

    const initialKey = h.winRateKeys.at(-1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: 'month' } });
    expect(h.winRateKeys.at(-1)).not.toBe(initialKey);
  });
});
