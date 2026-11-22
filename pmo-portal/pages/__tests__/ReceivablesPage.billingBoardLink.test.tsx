import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: 0 }));
const position = () => ({
  receivablesCount: 0, receivablesUnknownCount: 0, overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
  drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
  unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: {}, payablesUnknownCount: 0,
  receivablesAgeing: { IDR: { notDue: 0, noDueDate: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } },
  receivablesNoDueDateCounts: {}, payablesAgeing: {},
});

vi.mock('@/src/hooks/useBillingBoard', () => ({
  useBillingBoard: () => ({ data: { rows: Array.from({ length: state.rows }, (_, i) => ({ claimId: String(i) })), truncated: false } }),
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({ position: position(), today: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/finance/financePosition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/finance/financePosition')>();
  return { ...actual, buildFinancePosition: () => position() };
});
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/pages/SalesInvoices', () => ({ default: () => null }));
vi.mock('@/pages/IncomingPayments', () => ({ default: () => null }));

import ReceivablesPage from '../finance/ReceivablesPage';

const renderPage = () => render(<FinanceI18nTestProvider><MemoryRouter initialEntries={['/finance/receivables']}><ReceivablesPage /></MemoryRouter></FinanceI18nTestProvider>);

describe('Receivables billing board link', () => {
  afterEach(() => cleanup());

  it('AC-BBD-015 no link while no claim has billing steps', () => {
    state.rows = 0;
    renderPage();
    expect(screen.queryByTestId('receivables-billing-board-link')).toBeNull();
  });

  it('AC-BBD-015 the link opens the board when a claim has steps', () => {
    state.rows = 2;
    renderPage();
    expect(screen.getByTestId('receivables-billing-board-link').getAttribute('href')).toBe('/finance/billing-board');
  });
});
