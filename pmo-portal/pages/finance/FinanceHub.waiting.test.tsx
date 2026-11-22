/**
 * fix-waiting item 2: the Finance page shows what waits for Finance from the SAME list the home and the Approvals inbox read
 * (`useWaitingForYou`), so the two can never disagree: same rows, and the heading count is the list length.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

const w = vi.hoisted(() => ({ list: { entries: [] as unknown[], count: 0 as number | undefined, isPending: false, isError: false, refetch: () => undefined } }));
vi.mock('@/src/hooks/useWaitingForYou', () => ({ useWaitingForYou: () => w.list }));
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

import FinanceHub from './FinanceHub';

const entry = (kind: string, id: string, title: string) => ({ key: `${kind}:${id}`, kind, createdAt: '2026-11-18T00:00:00Z', row: { kind, recordId: id, projectId: null, title, createdAt: '2026-11-18T00:00:00Z' } });

const renderHub = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><FinanceHub /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.figures.mockResolvedValue({ asAt: '2026-10-01', unbilled: [], contractRows: 0, invoicedBasisRows: 0, netProfit: null });
  h.monthlyInvoices.mockResolvedValue([]); h.paidPayments.mockResolvedValue([]); h.managementPack.mockResolvedValue(null);
  h.statementGet.mockResolvedValue(null); h.statementCatalogue.mockResolvedValue([]);
  w.list = { entries: [], count: 0, isPending: false, isError: false, refetch: () => undefined };
});
afterEach(() => vi.clearAllMocks());

describe('the Finance page shows the one waiting list', () => {
  it('JOB-WAIT-2 lists what waits for Finance with the same count as the list, linking to the inbox', async () => {
    w.list = { ...w.list, count: 2, entries: [entry('daily_report', 'd1', 'WO-7 · Slab'), entry('work_order_issue', 'w1', 'WO-9 · Roof')] };
    renderHub();
    const card = await screen.findByTestId('finance-hub-waiting');
    expect(within(card).getByText('Waiting for your decision (2)')).toBeInTheDocument();
    expect(within(card).getAllByTestId('approval-item')).toHaveLength(2);
    expect(within(card).getByRole('link', { name: /All 2 approvals/ })).toHaveAttribute('href', '/approvals');
  });

  it('JOB-WAIT-2 says nothing is waiting when the list is empty, and never a count while the list is incomplete', async () => {
    renderHub();
    expect(await screen.findByText('Nothing is waiting for your decision.')).toBeInTheDocument();
    cleanup();
    w.list = { ...w.list, count: undefined, isPending: true };
    renderHub();
    const card = await screen.findByTestId('finance-hub-waiting');
    expect(within(card).getByText('Waiting for your decision')).toBeInTheDocument();
  });

  it('a failed list says so with a retry, not "nothing waiting"', async () => {
    w.list = { ...w.list, count: undefined, isError: true };
    renderHub();
    expect(await screen.findByText("Couldn't load what is waiting for you")).toBeInTheDocument();
    expect(screen.queryByText('Nothing is waiting for your decision.')).not.toBeInTheDocument();
  });
});
