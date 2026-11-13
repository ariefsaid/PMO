import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

const state = vi.hoisted(() => ({
  role: 'Finance',
  currency: 'IDR',
  position: null as FinancePosition | null,
  financeSources: {
    invoicesPending: false,
    invoicesError: false,
    paymentsPending: false,
    paymentsError: false,
    procurementsPending: false,
    procurementsError: false,
    orgDayPending: false,
    orgDayError: false,
  },
  positionRetry: vi.fn(),
  erp: { isPending: false, isError: false, refetch: vi.fn() },
  figures: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: state.role, effectiveRole: state.role }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'integration') return state.role === 'Admin' && action === 'manage';
    if (entity === 'finance') return ['Finance', 'Executive', 'Admin'].includes(state.role) && (action === 'view' || (action === 'act' && state.role !== 'Executive'));
    return action === 'view' && state.role !== 'Project Manager' && state.role !== 'Engineer';
  },
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }) }));
vi.mock('@/src/components/finance/BudgetDraftReview', () => ({ BudgetDraftReview: () => null }));
vi.mock('@/src/components/integrations/InvoicePairReview', () => ({ InvoicePairReview: () => null }));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: state.position,
    today: '2026-10-27',
    ...state.financeSources,
    isPending: Object.entries(state.financeSources).some(([key, value]) => key.endsWith('Pending') && value),
    isError: Object.entries(state.financeSources).some(([key, value]) => key.endsWith('Error') && value),
    retry: state.positionRetry,
  }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], ...state.erp }) }));
vi.mock('@/src/hooks/useFinanceHubFigures', () => ({ useFinanceHubFigures: () => state.figures }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({
    data: { totals: [{ currency: 'IDR', months: ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((month) => ({ month, invoiced: 100_000 })) }] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevenue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useRevenue')>()),
  useMonthlyInvoiceFacts: () => ({ data: [{ invoice_date: '2026-09-01', currency: 'IDR', net: 1000, recovery: 0 }], isPending: false, isError: false, refetch: vi.fn() }),
  usePaidPaymentFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: state.currency, isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));

import FinanceHub from './FinanceHub';

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

function positionFixture(): FinancePosition {
  return {
    overdue: Array.from({ length: 5 }, (_, index) => ({
      invoice: {
        id: `invoice-${index + 1}`, project_id: null, customer_name: `Client ${index + 1}`, si_number: `INV-${index + 1}`,
        invoice_date: '2026-07-15', erp_payment_terms_days: 0, erp_due_date: '2026-07-15', received_date: null,
        amount: 10_000_000, tax_amount: 0, tax_treatment: 'exclusive', currency: 'IDR', status: 'Unpaid', erp_outstanding_amount: 9_000_000,
      } as never,
      daysOverdue: 104 - index,
      outstanding: 900_000_000,
    })),
    overdueTotals: { IDR: 4_500_000_000 },
    overdueUnknownCount: 0,
    receivablesCount: 5,
    receivablesUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] },
    toSend: [],
    unappliedPayments: [],
    unappliedTotals: {},
    payables: [{ procurement: { id: 'procurement-1', vendor_id: 'supplier-1', vendor: { name: 'Supplier A' } } as never, ageDays: 100, amount: 6_240_000_000 }],
    payablesTotals: { IDR: 6_240_000_000, USD: 500_000 },
    payablesUnknownCount: 0,
    receivablesAgeing: { IDR: { notDue: 3_820_000_000, noDueDate: 0, d1_30: 1_220_000_000, d31_60: 1_430_000_000, d61_90: 0, over90: 1_850_000_000 } },
    receivablesNoDueDateCounts: {},
    payablesAgeing: { IDR: { d0_30: 2_100_000_000, d31_60: 940_000_000, d61_90: 1_200_000_000, over90: 2_000_000_000 } },
  };
}

function renderHub(role = 'Finance') {
  state.role = role;
  state.position = positionFixture();
  return render(<MemoryRouter><FinanceHub /><CurrentLocation /></MemoryRouter>);
}

function route() {
  return screen.getByLabelText('Current location').textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.currency = 'IDR';
  state.role = 'Finance';
  state.position = positionFixture();
  state.financeSources = {
    invoicesPending: false,
    invoicesError: false,
    paymentsPending: false,
    paymentsError: false,
    procurementsPending: false,
    procurementsError: false,
    orgDayPending: false,
    orgDayError: false,
  };
  state.erp = { isPending: false, isError: false, refetch: vi.fn() };
  state.figures = {
    data: {
      pack: { asAt: '2026-10-01', unbilled: [{ currency: 'IDR', cents: 1_230_000 }, { currency: 'USD', cents: 500_000 }], contractRows: 2, invoicedBasisRows: 2 },
      statement: { unpublished: true, periodStart: null, netProfit: null, currency: null },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
});

afterEach(cleanup);

describe('Finance hub floor controls', () => {
  it('floor: header New invoice opens the create route', () => {
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }));
    expect(route()).toBe('/finance/receivables?create=1');
  });

  it('floor: phone New invoice opens the same create route', () => {
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }));
    expect(route()).toBe('/finance/receivables?create=1');
  });

  it('floor: hidden figures fix links open the reports destination', () => {
    state.figures.data = {
      pack: { asAt: '2026-10-01', unbilled: [], contractRows: 2, invoicedBasisRows: 1 },
      statement: { unpublished: true, periodStart: null, netProfit: null, currency: null },
    };
    renderHub();
    fireEvent.click(screen.getByRole('link', { name: 'Open reports' }));
    expect(route()).toBe('/finance/reports');
  });

  it('floor: Receivables tile opens the receivables list', () => {
    renderHub();
    fireEvent.click(screen.getByRole('link', { name: 'Open Receivables' }));
    expect(route()).toBe('/finance/receivables');
  });

  it('floor: See invoices opens the receivables list for hidden balances', () => {
    state.position = { ...positionFixture(), receivablesAgeing: {}, receivablesUnknownCount: 1 };
    render(<MemoryRouter><FinanceHub /><CurrentLocation /></MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: 'See invoices' }));
    expect(route()).toBe('/finance/receivables');
  });

  it('floor: Payables tile opens the payables list', () => {
    renderHub();
    fireEvent.click(screen.getByRole('link', { name: 'Open Payables' }));
    expect(route()).toBe('/finance/payables');
  });

  it('floor: See payables opens the payables list for hidden balances', () => {
    state.position = { ...positionFixture(), payablesTotals: {} };
    render(<MemoryRouter><FinanceHub /><CurrentLocation /></MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: 'See payables' }));
    expect(route()).toBe('/finance/payables');
  });

  it('floor: accounting Set up opens integration administration', () => {
    state.role = 'Admin';
    renderHub('Admin');
    fireEvent.click(screen.getByRole('link', { name: 'Set up' }));
    expect(route()).toBe('/administration/integrations');
  });

  it('floor: receivables ageing Retry reloads finance data', () => {
    state.financeSources.invoicesError = true;
    renderHub();
    fireEvent.click(within(screen.getByRole('region', { name: 'Ageing' })).getByRole('button', { name: 'Retry' }));
    expect(state.positionRetry).toHaveBeenCalledOnce();
    expect(state.erp.refetch).toHaveBeenCalledOnce();
  });

  it('floor: payables ageing Retry reloads finance data', () => {
    state.financeSources.procurementsError = true;
    renderHub();
    fireEvent.click(within(screen.getByRole('region', { name: 'Ageing' })).getByRole('button', { name: 'Retry' }));
    expect(state.positionRetry).toHaveBeenCalledOnce();
    expect(state.erp.refetch).toHaveBeenCalledOnce();
  });
});
