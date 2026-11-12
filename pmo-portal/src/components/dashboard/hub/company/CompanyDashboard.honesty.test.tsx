/**
 * Ported from the deleted ExecutiveDashboard.{honesty,mobile}.test.tsx: money honesty on the
 * company figures, asserted through the real figure hook (only the data sources are stubbed).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
const h = vi.hoisted(() => ({ pipeline: null as unknown, budgetReviewHangs: false, dash: null as unknown, win: null as unknown, pack: null as unknown, loss: null as unknown, delivery: {} as Record<string, number>, projectsPending: false, invoices: [] as unknown[] }));
const attn = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, short_name: null, client_name: null, contract_value: 100, currency: 'USD', budget: null, spent: null, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD',
  status: 'Ongoing Project', attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: null, ...over,
});

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
  useOverdueInvoiceFacts: () => ({ data: h.invoices, isPending: false, isError: false, refetch: vi.fn() }),
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
  // Never resolves when set: a slow read the finding line does not depend on.
  getFinanceBudgetReview: () => (h.budgetReviewHangs ? new Promise(() => {}) : Promise.resolve([])),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: h.dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: h.pipeline, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: h.win, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: h.loss, isPending: h.loss === null, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: h.delivery, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: h.projectsPending ? undefined : [], isPending: h.projectsPending, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));

import { CompanyDashboard } from './CompanyDashboard';

const renderDashboard = (role: 'Executive' | 'Finance' = 'Executive') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ToastProvider><CompanyDashboard role={role} /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);
const renderExec = () => renderDashboard('Executive');

const figures = () => screen.getByRole('region', { name: /Company figures|Angka perusahaan/ });
const tile = (label: string) => {
  const element = within(figures()).getByText(label, { exact: true }).parentElement?.parentElement?.parentElement;
  expect(element).toBeTruthy();
  return element as HTMLElement;
};

beforeEach(() => {
  h.dash = { ...base };
  h.pipeline = { stages: [], projects: [] };
  h.win = null;
  h.pack = { months: [], rows: [], totals: [] };
  h.loss = null;
  h.delivery = {};
  h.projectsPending = false;
  h.invoices = [];
  h.budgetReviewHangs = false;
  localStorage.removeItem('home-layout');
});
afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('company figures honesty (AC-IXD-DASH-002, mixed currency)', () => {
  it('Finance opens an over-budget project directly on its Budget tab from Project health', () => {
    h.dash = {
      ...base,
      attention_projects: [attn('p1', 'Over-budget project', {
        budget: 100,
        spent: 120,
        over_budget: true,
        budget_used_ratio: 1.2,
      })],
    };

    renderDashboard('Finance');

    expect(within(screen.getByTestId('project-health')).getByRole('link', { name: /Over-budget project/ }))
      .toHaveAttribute('href', '/projects/p1/budget');
  });

  it('Project health draws budget against actual spending per project, with the share delivered and the contract as a quiet figure', () => {
    h.dash = {
      ...base,
      attention_projects: [attn('p1', 'River project', { budget: 1_500_000, spent: 900_000, contract_value: 2_000_000 })],
    };
    h.delivery = { p1: 51 };
    renderExec();
    const row = within(screen.getByTestId('project-health')).getByRole('link', { name: /River project/ });
    expect(row).toHaveTextContent('$900K spent of $1.5M budget · 51% delivered');
    expect(row).toHaveTextContent('Contract $2M');
    // Spent 60% of budget with 51% delivered: spending is ahead of delivery.
    expect(within(row).getByTestId('health-bullet')).toHaveAttribute('data-tone', 'ahead');
  });

  it('a project with no spending recorded keeps its budget track, says so in words, and is never drawn as zero spent', () => {
    h.dash = { ...base, attention_projects: [attn('p1', 'Quiet project', { budget: 500_000, spent: null, actual_complete: false })] };
    renderExec();
    const row = within(screen.getByTestId('project-health')).getByRole('link', { name: /Quiet project/ });
    expect(row).toHaveTextContent('No spending recorded · $500K budget');
    expect(row).not.toHaveTextContent('$0 spent');
  });

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
  h.pipeline = { stages: [], projects: [] };
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent('2 with a signed contract');
    expect(within(figures()).getByRole('link', { name: /Contract on hand/ })).toHaveAttribute('href', '/projects?filter=on-hand');
  });

  it('AC-IXD-DASH-W5-C2A: the caption counts every on-hand state the figure sums (ongoing, on hold, close-out, won pending kickoff), never leads', () => {
    h.dash = { ...base, active_projects: 1, projects_by_status: [
      { status: 'Ongoing Project', count: 1 }, { status: 'Close Out', count: 2 }, { status: 'On Hold', count: 1 }, { status: 'Won, Pending KoM', count: 1 }, { status: 'Leads', count: 9 },
    ] };
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent('5 with a signed contract');
  });

  it('AC-UXA-003: labels the Ongoing project count in Bahasa and links to that set', async () => {
    i18next.addResourceBundle('id', 'dashboard', idDashboard, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    h.dash = { ...base, active_projects: 2 };
    renderExec();
    expect(tile('Kontrak berjalan')).toHaveTextContent('2 dengan kontrak ditandatangani');
    expect(within(figures()).getByRole('link', { name: /Kontrak berjalan/ })).toHaveAttribute('href', '/projects?filter=on-hand');
  });

  it('AC-RD-RISK-001: unbudgeted active projects are named once, in the page\'s Why list with a link, so no off-track project is not read as all clear', async () => {
    h.dash = { ...base, risk_unchecked_projects: 2 };
    renderExec();
    fireEvent.click(await screen.findByRole('button', { name: 'Why' }));
    const notice = /Budget check unavailable for 2 projects/;
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.getAllByText(notice)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open projects' })).toHaveAttribute('href', '/projects');
  });

  it('Project health names each non-zero need in words, overdue and late in red, approvals not; zero needs are not printed', () => {
    h.dash = { ...base, attention_projects: [attn('p1', 'Project One', { attention_signals: 2, overdue_items: 3, overdue_tasks: 2, overdue_milestones: 1, waiting_approvals: 1 })] };
    renderExec();
    const wrong = within(screen.getByTestId('project-health')).getByTestId('health-wrong');
    expect(within(wrong).getByText('2 tasks overdue')).toHaveClass('text-destructive-text');
    expect(within(wrong).getByText('1 phase late')).toHaveClass('text-destructive-text');
    expect(within(wrong).getByText('1 awaiting approval')).not.toHaveClass('text-destructive-text');
    expect(wrong).not.toHaveTextContent(/0 invoices overdue/);
  });

  it('F2: an overdue-task count that is unknown is never printed as 0', () => {
    h.dash = { ...base, attention_projects: [attn('p1', 'Project One', { overdue_tasks: null as unknown as number, overdue_milestones: 1, attention_signals: 1, overdue_items: 1 })] };
    renderExec();
    const health = screen.getByTestId('project-health');
    expect(health).not.toHaveTextContent(/0 tasks? overdue/);
    expect(health).toHaveTextContent('1 phase late');
  });

  it('F1: "All N projects" never reads "All 0 projects" while the project list is loading', () => {
    h.projectsPending = true;
    renderExec();
    expect(screen.queryByText(/All 0 projects/)).not.toBeInTheDocument();
  });

  it('Project health lists projects worst first, off-track before the rest', () => {
    h.dash = {
      ...base,
      attention_projects: [
        attn('p1', 'Calm project'),
        attn('p2', 'Late project', { attention_signals: 1, overdue_items: 4, overdue_milestones: 4 }),
        attn('p3', 'Worse project', { attention_signals: 2, overdue_items: 2, overdue_tasks: 2, over_budget: true }),
      ],
    };
    renderExec();
    const names = within(screen.getByTestId('project-health')).getAllByRole('link').filter((link) => /^\/projects\/p\d$/.test(link.getAttribute('href') ?? '')).map((link) => link.textContent ?? '');
    expect(names.map((name) => name.match(/(Calm|Late|Worse) project/)?.[0])).toEqual(['Worse project', 'Late project', 'Calm project']);
  });

  it('the finding line names the operations fact, the finance fact and what waits, each linked', async () => {
    h.dash = { ...base, active_delivery_projects: 11, attention_projects: [attn('p1', 'Late project', { attention_signals: 1, overdue_items: 1, overdue_milestones: 1 }), attn('p2', 'Calm project')] };
    renderExec();
    const finding = screen.getByTestId('home-finding');
    expect(within(finding).getByRole('link', { name: '1 of 11 active projects off track' })).toHaveAttribute('href', '/projects');
    expect(await within(finding).findByRole('link', { name: 'No client invoice overdue' })).toHaveAttribute('href', '/finance/receivables?overdue=true');
  });

  it('the finance clause waits only on its own invoices read: a slow unrelated read never drops it from the finding line', async () => {
    h.budgetReviewHangs = true;
    renderExec();
    const finding = screen.getByTestId('home-finding');
    expect(await within(finding).findByRole('link', { name: 'No client invoice overdue' })).toHaveAttribute('href', '/finance/receivables?overdue=true');
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

  it('L6: Won reads "Won · 3" with "$14.4M" once, in the Sales card, with no second "3 projects won" line', () => {
    h.win = { wins_count: 3, losses_count: 2, wins_value: 14_400_000, losses_value: 0, win_rate_count: 0.6, win_rate_value: 0.5, value_by_currency: [{ currency: 'USD', wins_value: 14_400_000, losses_value: 0 }] };
    renderExec();
    const won = screen.getByRole('button', { name: /Won · 3/ });
    expect(won).toHaveTextContent('$14.4M');
    expect(screen.queryByText(/projects? won/)).not.toBeInTheDocument();
  });

  it('L2: Invoiced puts one currency per line, the organisation currency first', () => {
    const january = `${new Date().getFullYear()}-01`;
    h.pack = { months: [{ month: january }], rows: [], totals: [
      { currency: 'IDR', months: [{ month: january, invoiced: 11_470_000_000 }] },
      { currency: 'USD', months: [{ month: january, invoiced: 1_180_000_000 }] },
    ] };
    renderExec();
    const invoiced = tile('Invoiced');
    const lines = within(invoiced).getAllByText(/115M|11\.8M/).filter((line) => line.children.length === 0);
    expect(lines.map((line) => line.textContent?.replace(/\u00a0/g, ' '))).toEqual(['$11.8M', 'IDR 115M']);
    expect(invoiced.querySelector('[title="$11,800,000; IDR\u00a0114,700,000"]')).not.toBeNull();
  });

  it('Finances: owed to us is the known total split into not yet due and overdue, with one line of counts; an unknown balance is named there, never added', () => {
    h.invoices = [
      { id: 'i1', status: 'Unpaid', currency: 'USD', invoice_date: '2026-10-20', erp_due_date: '2026-11-19', received_date: null, erp_outstanding_amount: 300_000, erp_payment_terms_days: 30 },
      { id: 'i2', status: 'Unpaid', currency: 'USD', invoice_date: '2026-06-01', erp_due_date: '2026-06-29', received_date: null, erp_outstanding_amount: 100_000, erp_payment_terms_days: 30 },
      { id: 'i3', status: 'Unpaid', currency: 'USD', invoice_date: '2026-09-01', erp_due_date: '2026-09-30', received_date: null, erp_outstanding_amount: null, erp_payment_terms_days: 30 },
    ];
    renderExec();
    const owed = screen.getByTestId('owed-to-us');
    expect(owed).toHaveTextContent('$400K');
    expect(owed).toHaveTextContent('Not yet due $300K');
    expect(owed).toHaveTextContent('Overdue $100K');
    // 2026-06-29 to the org day 2026-10-27 is 120 days.
    expect(owed).toHaveTextContent('3 invoices · oldest 120 days overdue');
    // The invoice behind it has no amount either: the line still names the count, never a guessed size.
    expect(within(owed).getAllByText('1 invoice, balance not reported')).toHaveLength(1);
    const notDue = within(owed).getByTestId('owed-to-us-not-due');
    const late = within(owed).getByTestId('owed-to-us-overdue');
    expect(notDue.style.flexGrow).toBe('0.75');
    expect(late.style.flexGrow).toBe('0.25');
    expect(within(screen.getByTestId('finances')).getByRole('link', { name: /Open receivables/ })).toHaveAttribute('href', '/finance/receivables');
  });

  it('the unknown-balance line names how much is invoiced behind it, so a large unknown cannot hide', () => {
    h.invoices = [
      { id: 'i1', status: 'Unpaid', currency: 'USD', invoice_date: '2026-10-20', erp_due_date: '2026-11-19', received_date: null, erp_outstanding_amount: 300_000, erp_payment_terms_days: 30, amount: 300_000 },
      { id: 'i2', status: 'Unpaid', currency: 'USD', invoice_date: '2026-09-01', erp_due_date: '2026-09-30', received_date: null, erp_outstanding_amount: null, erp_payment_terms_days: 30, amount: 2_500_000 },
    ];
    renderExec();
    const owed = screen.getByTestId('owed-to-us');
    // The known total is unchanged: the unknown invoice is named, never added.
    expect(owed).toHaveTextContent('$300K');
    expect(owed).not.toHaveTextContent('$2.8M');
    expect(within(owed).getAllByText('1 invoice, $2.5M invoiced, balance not reported')).toHaveLength(1);
  });

  it('an unknown balance in two currencies gives each currency its own line, the organisation currency first', () => {
    h.invoices = [
      { id: 'i1', status: 'Unpaid', currency: 'IDR', invoice_date: '2026-09-01', erp_due_date: '2026-09-30', received_date: null, erp_outstanding_amount: null, erp_payment_terms_days: 30, amount: 4_000_000_000 },
      { id: 'i2', status: 'Unpaid', currency: 'USD', invoice_date: '2026-10-01', erp_due_date: '2026-10-31', received_date: null, erp_outstanding_amount: null, erp_payment_terms_days: 30, amount: 2_500_000 },
    ];
    renderExec();
    const lines = within(screen.getByTestId('owed-to-us')).getAllByTestId('owed-to-us-unknown-line')
      .map((line) => line.textContent?.replace(/\u00a0/g, ' '));
    expect(lines).toEqual(['1 invoice, $2.5M invoiced, balance not reported', '1 invoice, IDR 4B invoiced, balance not reported']);
  });

  it('AC-1461: Owed to suppliers carries its payables link, and an empty side reads as a known zero', () => {
    renderExec();
    const suppliers = screen.getByTestId('owed-to-suppliers');
    expect(within(screen.getByTestId('finances')).getByRole('link', { name: /Open payables/ })).toHaveAttribute('href', '/finance/payables');
    expect(suppliers).toHaveTextContent('$0');
    expect(suppliers).not.toHaveTextContent('Not yet due');
    expect(suppliers).toHaveTextContent('No supplier invoice to pay');
  });

  it('Project health links to all projects without restating a count it does not share', () => {
    renderExec();
    const link = within(screen.getByTestId('project-health')).getByRole('link', { name: /All projects/ });
    expect(link).toHaveTextContent(/^All projects$/);
  });
});

describe('pipeline currency safety', () => {
  const stage = { status: 'Leads', count: 2, total_value: 3000, weighted_value: 1500, win_probability: 0.5 };
  const project = (currency: string) => ({ status: 'Leads', currency, contract_value: 1000 });
  it('withholds mixed stage and pipeline weighted amounts and forecast margin with reasons', async () => {
    h.pipeline = { stages: [stage], projects: [project('USD'), project('IDR')] };
    h.dash = { ...base, pipeline_total_value_by_currency: [{ currency: 'USD', total_value: 1000, weighted_value: 500 }, { currency: 'IDR', total_value: 2000, weighted_value: 1000 }] };
    renderExec();
    const sales = screen.getByTestId('sales-overview');
    expect(within(sales).getByRole('link', { name: /Leads/ })).not.toHaveTextContent('$1.5K');
    expect(within(sales).queryByText('Forecast margin: 20.0%')).toBeNull();
    expect(within(sales).queryByText('Weighted pipeline')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Why' }));
    expect(screen.getByText(/pipeline.*mixed currencies/i)).toBeInTheDocument();
    expect(screen.getByText(/forecast margin.*currency/i)).toBeInTheDocument();
  });
  it('places won amounts in separate currency lines', () => {
    h.pipeline = { stages: [stage], projects: [project('USD')] };
    h.win = { wins_count: 2, losses_count: 0, value_by_currency: [{ currency: 'USD', wins_value: 1000, losses_value: 0 }, { currency: 'IDR', wins_value: 2000, losses_value: 0 }] };
    renderExec();
    const won = within(screen.getByTestId('sales-overview')).getByRole('button', { name: /Won/ });
    expect([...won.querySelectorAll('[data-currency-line]')].map((line) => line.textContent?.replace(/\u00a0/g, ' '))).toEqual(['$1K', '+ IDR 2K']);
  });
  it('focused home withholds mixed stage amounts and separates won currencies', () => {
    localStorage.setItem('home-layout', 'focused');
    h.pipeline = { stages: [stage], projects: [project('USD'), project('IDR')] };
    h.win = { wins_count: 2, losses_count: 0, value_by_currency: [{ currency: 'USD', wins_value: 1000, losses_value: 0 }, { currency: 'IDR', wins_value: 2000, losses_value: 0 }] };
    renderExec();
    expect(screen.getByRole('button', { name: /Leads/ })).not.toHaveTextContent('$1.5K');
    expect(screen.getByRole('button', { name: /Won/ }).querySelectorAll('[data-currency-line]')).toHaveLength(2);
  });
  it('withholds margin for a foreign-only pipeline', async () => {
    h.pipeline = { stages: [stage], projects: [project('IDR'), project('IDR')] };
    renderExec();
    expect(screen.queryByText(/Forecast margin: 20/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Why' }));
    expect(screen.getByText(/forecast margin.*currency/i)).toBeInTheDocument();
  });
  it('keeps stage weighted amount and forecast margin for an org currency pipeline', () => {
    h.pipeline = { stages: [stage], projects: [project('USD'), project('USD')] };
    renderExec();
    const sales = screen.getByTestId('sales-overview');
    expect(within(sales).getByRole('link', { name: /Leads/ })).toHaveTextContent('$1.5K');
    expect(within(sales).getByText('Forecast margin: 20.0%')).toBeInTheDocument();
  });
});

it('focused owed caption omits mixed currency amounts when it cannot show separate lines', () => {
  localStorage.setItem('home-layout', 'focused');
  h.invoices = [
    { id: 'a', status: 'Unpaid', currency: 'USD', invoice_date: '2026-06-01', erp_due_date: '2026-06-29', received_date: null, erp_outstanding_amount: 1000, erp_payment_terms_days: 30 },
    { id: 'b', status: 'Unpaid', currency: 'IDR', invoice_date: '2026-06-01', erp_due_date: '2026-06-29', received_date: null, erp_outstanding_amount: 2000, erp_payment_terms_days: 30 },
  ];
  renderExec();
  expect(tile('Owed by clients')).toHaveTextContent('2 overdue');
  expect(tile('Owed by clients')).not.toHaveTextContent('$1K + IDR 2K overdue');
});
