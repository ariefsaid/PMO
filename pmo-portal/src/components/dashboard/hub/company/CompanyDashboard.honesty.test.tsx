/**
 * Ported from the deleted ExecutiveDashboard.{honesty,mobile}.test.tsx: money honesty on the
 * company figures, asserted through the real figure hook (only the data sources are stubbed).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui/Toast';
import idDashboard from '../../../../../public/locales/id/dashboard.json';

const base = {
  active_projects: 2,
  active_delivery_projects: 2,
  risk_unchecked_projects: 0,
  total_contract_value: 8_000_000,
  on_hand_value: 8_000_000,
  on_hand_contract_remaining: 6_000_000,
  on_hand_realized_margin: 1_000_000,
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 1_000_000, known_billed_revenue: 8_000_000, unknown_projects: 0 }],
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8_000_000, actual_known: 2_000_000, contract_remaining: 6_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 1_000_000, unknown_projects: 0 }],
  on_hand_actual_coverage_count: 2,
  on_hand_actual_coverage_total: 2,
  pipeline_weighted_value: 800_000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 2_000_000,
  pipeline_total_value_by_currency: [{ currency: 'USD', total_value: 2_000_000, weighted_value: 800_000, forecast_margin: 0.2, no_active_budget: 0 }],
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
  useOverdueInvoiceFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  usePaidPaymentFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnySalesInvoice: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
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
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
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

const figures = () => screen.getByRole('region', { name: /Company figures|Angka perusahaan/ });
const tile = (label: string) => {
  const element = within(figures()).getByText(label, { exact: true }).parentElement?.parentElement?.parentElement;
  expect(element).toBeTruthy();
  return element as HTMLElement;
};

beforeEach(() => { h.dash = { ...base }; h.win = null; h.pack = { totals: [] }; });
afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('company figures honesty (AC-IXD-DASH-002, mixed currency)', () => {
  it('AC-IXD-DASH-002: no figure carries the ambiguous "Projected margin" name; forecast margin appears once, on the weighted pipeline', () => {
    renderExec();
    expect(screen.queryByText(/^Projected margin$/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Forecast margin/)).toHaveLength(1);
    expect(screen.getByText('Weighted pipeline').parentElement).toHaveTextContent('Forecast margin: 20.0%');
  });

  it('AC-1414: known margin on billed work is the known amount; it is drawn only when the accounting source provides one', () => {
    h.dash = {
      ...base,
      on_hand_realized_margin_by_currency: [
        { currency: 'USD', known_amount: 1_000_000, known_billed_revenue: 8_000_000, unknown_projects: 1 },
      ],
    };
    const { unmount } = renderExec();
    const margin = tile('Known margin on billed work');
    expect(margin).toHaveTextContent('$1M');
    expect(margin.querySelector('[title="$1,000,000"]')).not.toBeNull();
    unmount();

    h.dash = { ...base, on_hand_realized_margin: null, on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: null, known_billed_revenue: null, unknown_projects: 2 }] };
    renderExec();
    expect(screen.queryByText('Known margin on billed work')).not.toBeInTheDocument();
  });

  it('AC-RD-SPEND-001: Contract on hand states the contract total only, never a remaining or "left" figure that could hide missing actuals', () => {
    h.dash = { ...base, on_hand_actual_coverage_count: 1, on_hand_actual_coverage_total: 2 };
    renderExec();
    const contract = tile('Contract on hand');
    expect(contract).toHaveTextContent('$8M');
    expect(contract).not.toHaveTextContent(/left|remaining|partial/i);
  });

  it('AC-IXD-DASH-W5-C2A: Contract on hand counts the same on-hand projects it sums, and opens them', () => {
    h.dash = { ...base };
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent('2 projects');
    expect(within(figures()).getByRole('link', { name: /Contract on hand/ })).toHaveAttribute('href', '/projects?filter=on-hand');
  });

  it('AC-IXD-DASH-W5-C2A: the caption counts every on-hand state the figure sums (ongoing, on hold, close-out, won pending kickoff), never leads', () => {
    h.dash = { ...base, active_projects: 1, projects_by_status: [
      { status: 'Ongoing Project', count: 1 }, { status: 'Close Out', count: 2 }, { status: 'On Hold', count: 1 }, { status: 'Won, Pending KoM', count: 1 }, { status: 'Leads', count: 9 },
    ] };
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent('5 projects');
  });

  it('AC-UXA-003: labels the Ongoing project count in Bahasa and links to that set', async () => {
    i18next.addResourceBundle('id', 'dashboard', idDashboard, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    h.dash = { ...base, active_projects: 2 };
    renderExec();
    expect(tile('Kontrak berjalan')).toHaveTextContent('2 proyek');
    expect(within(figures()).getByRole('link', { name: /Kontrak berjalan/ })).toHaveAttribute('href', '/projects?filter=on-hand');
  });

  it('AC-RD-RISK-001: unbudgeted active projects are named once under Projects off track, so no off-track project is not read as all clear', async () => {
    h.dash = { ...base, risk_unchecked_projects: 2 };
    renderExec();
    const notice = /2 projects can’t be checked against their budget/;
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.getAllByText(notice)).toHaveLength(1);
    expect(screen.queryByText('No project is off track.')).not.toBeInTheDocument();
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
    expect(contract).not.toHaveTextContent(/\$0\b/);
  });

  it('L6: Won reads "Won · Year to date · 3" with "$14.4M" once, in the Sales card, with no second "3 projects won" line', () => {
    h.win = { wins_count: 3, losses_count: 2, wins_value: 14_400_000, losses_value: 0, win_rate_count: 0.6, win_rate_value: 0.5, value_by_currency: [{ currency: 'USD', wins_value: 14_400_000, losses_value: 0 }] };
    renderExec();
    const won = screen.getByRole('button', { name: /Won · Year to date · 3/ });
    expect(won).toHaveTextContent('$14.4M');
    expect(screen.queryByText(/projects? won/)).not.toBeInTheDocument();
  });

  it('L2: Invoiced puts one currency per line, the organisation currency first', () => {
    const january = `${new Date().getFullYear()}-01`;
    h.pack = { totals: [
      { currency: 'IDR', months: [{ month: january, invoiced: 11_470_000_000 }] },
      { currency: 'USD', months: [{ month: january, invoiced: 1_180_000_000 }] },
    ] };
    renderExec();
    const invoiced = tile('Invoiced');
    const lines = within(invoiced).getAllByText(/115M|11\.8M/).filter((line) => line.children.length === 0);
    expect(lines.map((line) => line.textContent?.replace(/\u00a0/g, ' '))).toEqual(['$11.8M', '+ IDR 115M']);
    expect(invoiced.querySelector('[title="$11,800,000 + IDR\u00a0114,700,000"]')).not.toBeNull();
  });
});
