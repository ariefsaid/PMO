import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDay } from '@/src/lib/format';

const state = vi.hoisted(() => ({
  receivablesPending: false,
  receivablesError: false,
  cashPending: false,
  cashError: false,
  invoices: [] as unknown[],
  payments: [] as unknown[],
  position: null as unknown,
}));

vi.mock('@/src/hooks/useReceivablesPagePosition', () => ({
  useReceivablesPagePosition: () => ({
    position: state.position,
    today: '2026-10-18',
    invoices: state.invoices,
    payments: state.payments,
    invoiceCount: state.invoices.length,
    paymentCount: state.payments.length,
    receivablesPending: state.receivablesPending,
    receivablesError: state.receivablesError,
    cashPending: state.cashPending,
    cashError: state.cashError,
    retryReceivables: vi.fn(),
    retryCash: vi.fn(),
  }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/pages/SalesInvoices', () => ({ default: () => <div>Invoice list</div> }));
vi.mock('@/pages/IncomingPayments', () => ({ default: () => <div>Payment list</div> }));

import ReceivablesPage from './ReceivablesPage';

const positionFixture = () => ({
  receivablesCount: 2,
  receivablesUnknownCount: 0,
  overdue: [
    { invoice: { id: 'late-1' }, daysOverdue: 104, outstanding: 700 },
    { invoice: { id: 'late-2' }, daysOverdue: 31, outstanding: 300 },
  ],
  overdueTotals: { IDR: 1000 },
  overdueUnknownCount: 0,
  receivablesAgeing: { IDR: { notDue: 1000, noDueDate: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } },
  receivablesNoDueDateCounts: {},
  payables: [],
  payablesTotals: {},
  payablesUnknownCount: 0,
  payablesAgeing: {},
  drafts: { canApprove: [], awaitingOther: [], all: [] },
  toSend: [],
  unappliedPayments: [],
  unappliedTotals: {},
});

const openInvoice = (id: string, customerId: string, dueDate: string) => ({
  id,
  customer_id: customerId,
  customer_name: customerId,
  status: 'Unpaid',
  invoice_date: '2026-09-01',
  erp_due_date: dueDate,
  erp_payment_terms_days: 0,
  erp_outstanding_amount: 500,
  received_date: null,
  currency: 'IDR',
  amount: 500,
  tax_treatment: 'inclusive',
  tax_amount: 0,
});

function renderPage() {
  return render(<MemoryRouter><ReceivablesPage /></MemoryRouter>);
}

beforeEach(() => {
  state.receivablesPending = false;
  state.receivablesError = false;
  state.cashPending = false;
  state.cashError = false;
  state.invoices = [openInvoice('inv-1', 'client-1', '2026-10-20'), openInvoice('inv-2', 'client-2', '2026-10-31')];
  state.payments = [];
  state.position = positionFixture();
});

afterEach(cleanup);

describe('Receivables restore-e feature floor', () => {
  it('AC-R2R-E-005: shows invoice and client counts for Owed, overdue count and age, and the 30-day invoice count', () => {
    renderPage();

    expect(screen.getByText('2 invoices · 2 clients')).toBeInTheDocument();
    expect(screen.getByText('2 invoices · oldest 104 days')).toBeInTheDocument();
    expect(screen.getByText(`2 invoices · next due ${formatDay('2026-10-20')}`)).toBeInTheDocument();
  });

  it('AC-R2R-E-006: announces finance-figure loading to screen readers', () => {
    state.receivablesPending = true;
    renderPage();

    expect(screen.getAllByRole('status', { name: 'Loading figure' }).length).toBeGreaterThan(0);
  });
});
