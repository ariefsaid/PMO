/**
 * PERF-1988: the Finance hub reads its three figures (per-currency unbilled at the as-at month, the
 * contract rows and their progress-less count, the latest company P&L net profit) from the narrow
 * `get_finance_hub_figures` RPC — once — and never from the whole management pack or a full P&L
 * statement read. The money figures are identical to what the old pipeline derives from those full
 * reads on the same data: the envelope under test is BUILT from the real `buildManagementPack`
 * derivation, and the SQL equality itself is pgTAP-proven (0762_finance_hub_figures.test.sql).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

const h = vi.hoisted(() => ({
  figures: vi.fn(),
  monthlyInvoices: vi.fn(),
  paidPayments: vi.fn(),
  managementPack: vi.fn(),
  statementGet: vi.fn(),
  statementCatalogue: vi.fn(),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'integration') return action === 'manage';
    if (entity === 'finance' || entity === 'financialStatements') return action === 'view';
    return true;
  },
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }) }));
vi.mock('@/src/components/finance/BudgetDraftReview', () => ({ BudgetDraftReview: () => null }));
vi.mock('@/src/components/integrations/InvoicePairReview', () => ({
  InvoicePairReview: () => <section data-testid="invoice-pair-review" />,
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: {
      overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
      receivablesCount: 0, receivablesUnknownCount: 0, drafts: { canApprove: [], awaitingOther: [], all: [] },
      toSend: [], unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: {},
      payablesUnknownCount: 0, receivablesAgeing: {}, payablesAgeing: {},
    } as unknown as FinancePosition,
    today: '2026-11-07',
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
// Only the repository seam is stubbed: the real hooks run, so the narrow read and its absent
// alternatives are what is under test.
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return {
    ...actual,
    repositories: {
      ...actual.repositories,
      revenue: { ...actual.repositories.revenue, listMonthlyInvoiceFacts: h.monthlyInvoices, listPaidPaymentFacts: h.paidPayments },
      reports: { ...actual.repositories.reports, figures: h.figures, managementPack: h.managementPack },
      financialStatements: { ...actual.repositories.financialStatements, get: h.statementGet, catalogue: h.statementCatalogue },
    },
  };
});

import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';
import { formatTileMoney } from '@/src/lib/format';
import FinanceHub from './FinanceHub';

// The same data the full reads would return, in the facts shape get_management_pack produces.
const facts: ManagementPackFacts = {
  from: '2026-01-01',
  to: '2026-10-01',
  timezone: 'UTC',
  org_currency: 'IDR',
  undated_invoice_count: 0,
  projects: [
    { id: 'p1', name: 'Alpha', pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR', contract_net: 500_000, start_date: '2026-01-01', end_date: '2026-12-31', project_manager_id: null, client_name: null },
    { id: 'p2', name: 'Beta', pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR', contract_net: 250_000, start_date: '2026-01-01', end_date: '2026-12-31', project_manager_id: null, client_name: null },
  ],
  invoiced: [
    { project_id: 'p1', currency: 'IDR', month: '2026-10-01', net: 100_000, invoice_count: 1 },
    { project_id: 'p1', currency: 'USD', month: '2026-10-01', net: 5_000, invoice_count: 1 },
  ],
  invoiced_before: [{ project_id: 'p2', currency: 'IDR', net: 25_000, invoice_count: 1 }],
  progress: [],
};

// The client extraction the hub used before #1988 (payload of the full get_financial_statement read).
function netProfitFromPayload(payload: { current: { columns: Array<{ fieldname: string; type: string; hidden?: boolean }>; rows: Array<Record<string, unknown>> } }): number | null {
  const row = payload.current.rows.find((item) => {
    const label = typeof item.account_name === 'string' ? item.account_name : item.account;
    return typeof label === 'string' && /profit for the period/i.test(label.replaceAll("'", ''));
  });
  const amountColumn = payload.current.columns.find((column) => column.type === 'currency' && column.fieldname !== 'total' && !column.hidden);
  if (!row || !amountColumn) return null;
  const value = row[amountColumn.fieldname];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

const statementPayload = {
  current: {
    columns: [
      { fieldname: 'total', type: 'currency' },
      { fieldname: 'mine', type: 'currency' },
    ],
    rows: [
      { account_name: 'Revenue', mine: '1000.00', total: '1000.00' },
      { account_name: 'profit for the period', mine: '250.50', total: '250.50' },
    ],
  },
};

function envelopeFromOldPipeline(progress: ManagementPackFacts['progress']) {
  const pack = buildManagementPack({ ...facts, progress });
  const asAt = pack.to;
  const unbilled = pack.totals.map((total) => ({ currency: total.currency, cents: total.months[total.months.length - 1].unbilled }));
  const contractRows = pack.rows.filter((row) => row.kind === 'contract');
  return {
    asAt,
    unbilled,
    contractRows: contractRows.length,
    invoicedBasisRows: contractRows.filter((row) => row.latestProgress == null).length,
    netProfit: netProfitFromPayload(statementPayload),
  };
}

const renderHub = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><FinanceHub /></MemoryRouter>,
  </QueryClientProvider>,
);

beforeEach(() => {
  h.monthlyInvoices.mockReset().mockResolvedValue([]);
  h.paidPayments.mockReset().mockResolvedValue([]);
  h.figures.mockReset();
  h.managementPack.mockReset();
  h.statementGet.mockReset();
  h.statementCatalogue.mockReset();
});

afterEach(() => { vi.clearAllMocks(); });

describe('finance hub narrow figure read (PERF-1988)', () => {
  it('reads the figures once from the narrow RPC and never from the pack or a statement read', async () => {
    const derived = envelopeFromOldPipeline([
      { project_id: 'p1', month: '2026-09-01', pct_complete: 40, entered_at: '2026-09-30T00:00:00Z', entered_by_name: 'Alex Rivera' },
    ]);
    h.figures.mockResolvedValue({
      pack: { asAt: derived.asAt, unbilled: derived.unbilled, contractRows: derived.contractRows, invoicedBasisRows: derived.invoicedBasisRows },
      statement: { unpublished: false, periodStart: '2026-01-01', netProfit: derived.netProfit, currency: 'IDR' },
    });

    renderHub();

    // The figures render from the same numbers the old pipeline derived from the full pack:
    // the meaning lines appear only after the narrow read lands.
    await screen.findByText('through Oct 2026');
    const reports = screen.getByRole('link', { name: 'Open Reports' }).parentElement!;
    const leadCents = derived.unbilled.find((entry) => entry.currency === 'IDR')!.cents;
    // textContent compares byte-exact (the locale formatter's non-breaking spaces stay intact).
    expect(reports.textContent).toContain(formatTileMoney(leadCents / 100, 'IDR')!);

    const statements = screen.getByRole('link', { name: 'Open Statements' }).parentElement!;
    expect(statements.textContent).toContain(formatTileMoney(derived.netProfit!, 'IDR')!);
    expect(statements).toHaveTextContent('Jan 2026');

    await vi.waitFor(() => expect(h.figures).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(h.monthlyInvoices).toHaveBeenCalledWith("2026-05-01", "2026-11-01"));
    expect(h.paidPayments).toHaveBeenCalledTimes(1);
    expect(h.managementPack).not.toHaveBeenCalled();
    expect(h.statementGet).not.toHaveBeenCalled();
    expect(h.statementCatalogue).not.toHaveBeenCalled();
  });

  it('shows the same invoiced-basis line and zero-lead figures the full pack produced, with no progress recorded', async () => {
    const derived = envelopeFromOldPipeline([]);
    h.figures.mockResolvedValue({
      pack: { asAt: derived.asAt, unbilled: derived.unbilled, contractRows: derived.contractRows, invoicedBasisRows: derived.invoicedBasisRows },
      statement: { unpublished: true, periodStart: null, netProfit: null, currency: null },
    });

    renderHub();

    // With every contract row on the invoiced basis the unbilled figure is a known 0 in the home currency,
    // and the zero USD total is filtered out (no second line for a zero).
    await screen.findByText('through Oct 2026');
    const reports = screen.getByRole('link', { name: 'Open Reports' }).parentElement!;
    const leadCents = derived.unbilled.find((entry) => entry.currency === 'IDR')!.cents;
    expect(reports.textContent).toContain(formatTileMoney(leadCents / 100, 'IDR')!);
    expect(reports).not.toHaveTextContent('USD');
    expect(h.figures).toHaveBeenCalledTimes(1);
    expect(h.managementPack).not.toHaveBeenCalled();
  });
});
