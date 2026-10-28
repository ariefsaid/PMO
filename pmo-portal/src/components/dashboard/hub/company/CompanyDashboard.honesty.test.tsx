/**
 * Ported from the deleted ExecutiveDashboard.{honesty,mobile}.test.tsx: money honesty on the
 * company figures, asserted through the real figure hook (only the data sources are stubbed).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';

const base = {
  active_projects: 2,
  active_delivery_projects: 2,
  risk_unchecked_projects: 0,
  total_contract_value: 8_000_000,
  on_hand_value: 8_000_000,
  on_hand_contract_remaining: 6_000_000,
  on_hand_realized_margin: 1_000_000,
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 1_000_000, unknown_projects: 0 }],
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8_000_000, actual_known: 2_000_000, contract_remaining: 6_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 1_000_000, unknown_projects: 0 }],
  on_hand_actual_coverage_count: 2,
  on_hand_actual_coverage_total: 2,
  pipeline_weighted_value: 800_000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 2_000_000,
  projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [],
  top_projects: [],
};
const h = vi.hoisted(() => ({ dash: null as unknown, win: null as unknown, pack: { totals: [] as unknown[] } }));

// Ready to pay / payables ageing read linked accounting documents (L12); none linked here.
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: h.pack, isPending: false, isError: false, refetch: vi.fn() }),
}));
// The needs-you hook reads the same dashboard RPC directly; serve it the same fixture.
vi.mock('@/src/lib/db/dashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/dashboard')>()),
  getExecutiveDashboard: async () => h.dash,
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: h.dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: h.win, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));

import { CompanyDashboard } from './CompanyDashboard';

const renderExec = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ToastProvider><CompanyDashboard role="Executive" /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

const figures = () => screen.getByRole('region', { name: 'Company figures' });
const tile = (label: string) => {
  const element = within(figures()).getByText(label, { exact: true }).parentElement?.parentElement?.parentElement;
  expect(element).toBeTruthy();
  return element as HTMLElement;
};

beforeEach(() => { h.dash = { ...base }; h.win = null; h.pack = { totals: [] }; });

describe('company figures honesty (AC-IXD-DASH-002, mixed currency)', () => {
  it('AC-IXD-DASH-002: no figure carries the ambiguous "Projected margin" name; forecast margin appears once, on the pipeline', () => {
    renderExec();
    expect(screen.queryByText(/^Projected margin$/i)).not.toBeInTheDocument();
    expect(within(figures()).getAllByText(/Forecast margin/)).toHaveLength(1);
    expect(tile('Pipeline (weighted)')).toHaveTextContent('Forecast margin: 20.0%');
  });

  it('AC-RD-SPEND-001: marks the remaining contract as partial when some actuals are not recorded yet', () => {
    h.dash = { ...base, on_hand_actual_coverage_count: 1, on_hand_actual_coverage_total: 2 };
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent(/Left after recorded spending \(Partial\)/);
  });

  it('AC-IXD-DASH-W5-C2A: Contract on hand opens the ongoing projects it sums', () => {
    h.dash = { ...base };
    renderExec();
    expect(within(figures()).getByRole('link', { name: /Contract on hand/ })).toHaveAttribute('href', '/projects?filter=Ongoing');
  });

  it('AC-RD-RISK-001: unbudgeted active projects are named in the Delivery panel, so zero at risk is not read as all clear', async () => {
    h.dash = { ...base, risk_unchecked_projects: 2 };
    renderExec();
    expect(await screen.findByText(/projects without an active budget; risk can't be checked yet/)).toBeInTheDocument();
  });

  it('AC-RD-SPEND-001: complete actuals carry no partial marker', () => {
    h.dash = { ...base };
    renderExec();
    expect(tile('Contract on hand')).not.toHaveTextContent(/Partial/);
  });

  it('shows mixed-currency contract on hand per currency, never as a blend or "USD $", with the exact amounts kept', () => {
    h.dash = {
      ...base,
      on_hand_value: null,
      on_hand_contract_remaining: null,
      on_hand_value_by_currency: [
        { currency: 'IDR', contract_value: 2_000_000_000, actual_known: 1_200_000_000, contract_remaining: 800_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 100_000_000, unknown_projects: 0 },
        { currency: 'USD', contract_value: 1_000_000, actual_known: null, contract_remaining: null, actual_coverage_count: 0, actual_coverage_total: 2, realized_margin_known: null, unknown_projects: 1 },
      ],
    };
    renderExec();
    const contract = tile('Contract on hand');
    expect(contract).toHaveTextContent('IDR 2B');
    expect(contract).toHaveTextContent('$1M');
    expect(contract).not.toHaveTextContent(/USD\s*\$/);
    expect(contract).not.toHaveTextContent(/2,001,000,000|2\.001/);
    // The exact amounts stay available (hover / screen reader).
    expect(contract).toHaveTextContent(/2,000,000,000/);
    expect(contract).toHaveTextContent(/1,000,000/);
    // The remainder is short per known currency; the unknown one is not shown as zero.
    expect(contract).toHaveTextContent('IDR 800M');
    expect(contract).not.toHaveTextContent(/\$0\b/);
  });

  it('L6: Won reads "3 · $14.4M" once — no second "3 projects won" line — and spans the Sales panel', () => {
    h.win = { wins_count: 3, losses_count: 2, wins_value: 14_400_000, losses_value: 0, win_rate_count: 0.6, win_rate_value: 0.5, value_by_currency: [{ currency: 'USD', wins_value: 14_400_000, losses_value: 0 }] };
    renderExec();
    const sales = screen.getByRole('heading', { name: 'Sales' }).closest('.rounded-lg.border') as HTMLElement;
    expect(within(sales).getByText('3 · $14.4M')).toBeInTheDocument();
    expect(within(sales).queryByText(/projects? won/)).not.toBeInTheDocument();
    expect(within(sales).getByText('3 · $14.4M').closest('.border-b')?.parentElement).toHaveClass('grid-cols-1');
  });

  it('L2: Billing puts one currency per line, the organisation currency first', () => {
    const january = `${new Date().getFullYear()}-01`;
    h.pack = { totals: [
      { currency: 'IDR', months: [{ month: january, invoiced: 11_470_000_000 }] },
      { currency: 'USD', months: [{ month: january, invoiced: 1_180_000_000 }] },
    ] };
    renderExec();
    const billing = screen.getByRole('heading', { name: 'Billing and collections' }).closest('.rounded-lg.border') as HTMLElement;
    const lines = within(billing).getAllByText(/114\.7M|11\.8M/);
    expect(lines.map((line) => line.textContent?.replace(/\u00a0/g, ' '))).toEqual(['$11.8M', 'IDR 114.7M']);
    for (const line of lines) expect(line).toHaveClass('block');
  });
});
