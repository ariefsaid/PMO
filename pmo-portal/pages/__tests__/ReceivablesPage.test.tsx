import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n } from './financeI18nTestInstance';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  role: 'Finance' as 'Finance' | 'Executive',
  invoices: [] as unknown[],
  payments: [] as unknown[],
  position: {
    overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
    unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: {},
    receivablesAgeing: { IDR: { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } },
    payablesAgeing: {},
  } as FinancePosition,
}));

vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({ position: h.position, today: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: h.invoices, isPending: false }),
  useIncomingPayments: () => ({ data: h.payments, isPending: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string) => h.role !== 'Executive' || action === 'view',
}));
vi.mock('@/pages/SalesInvoices', () => ({ default: () => null }));
vi.mock('@/pages/IncomingPayments', () => ({ default: () => null }));

import ReceivablesPage from '../finance/ReceivablesPage';

const invoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'invoice-1', org_id: 'org-1', project_id: 'project-1', erp_project: null,
  customer_id: 'client-1', customer_name: 'Northwind', si_number: 'SI-1', reference_number: null,
  invoice_date: '2026-10-22', amount: 100, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0,
  erp_outstanding_amount: 100, status: 'Unpaid', erp_docstatus: 1, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-22T00:00:00Z',
  author_user_id: 'author-1', author_user_ids: ['author-1'], erp_payment_terms_days: 14,
  erp_due_date: null, received_date: null, efaktur_number: null, efaktur_date: null, ...over,
});

const payment = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'payment-1', org_id: 'org-1', customer_id: 'client-1', customer_name: 'Northwind',
  sales_invoice_id: null, ip_number: 'IP-1', reference_number: null, date: '2026-10-05',
  amount: 150, currency: 'IDR', received_amount: 100, withheld_amount: 50,
  withholding_slip_number: null, allocation_details: [], status: 'Paid', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-05T00:00:00Z',
  ...over,
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(initialEntry = '/finance/receivables') {
  return render(
    <FinanceI18nTestProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes><Route path="/finance/receivables" element={<ReceivablesPage />} /></Routes>
        <LocationProbe />
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );
}

beforeEach(async () => {
  h.role = 'Finance';
  h.invoices = [invoice(), invoice({ id: 'invoice-2', si_number: 'SI-2', invoice_date: '2026-10-01', erp_payment_terms_days: 14 })];
  h.payments = [
    payment(),
    payment({ id: 'payment-previous', date: '2026-09-05', amount: 40, received_amount: 40, withheld_amount: 0 }),
    payment({ id: 'payment-cancelled', date: '2026-10-06', amount: 999, received_amount: 999, cancelled_at: '2026-10-07T00:00:00Z' }),
    payment({ id: 'payment-scheduled', date: '2026-10-12', amount: 500, received_amount: 500, status: 'Scheduled' }),
  ];
  h.position = {
    overdue: [{ invoice: invoice({ id: 'overdue', erp_outstanding_amount: 10 }), daysOverdue: 5, outstanding: 1000 }],
    overdueTotals: { IDR: 1000 }, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [], unappliedPayments: [], unappliedTotals: {},
    payables: [], payablesTotals: {},
    receivablesAgeing: { IDR: { notDue: 8000, d1_30: 1000, d31_60: 0, d61_90: 0, over90: 1000 } },
    payablesAgeing: {},
  };
  await financeTestI18n.changeLanguage('en');
});

describe('Receivables page', () => {
  it('uses the shared ageing and overdue totals, with invoice and client counts', () => {
    renderPage();
    const owed = screen.getByRole('region', { name: 'Owed to you' });
    expect(within(owed).getByText(/100/)).toBeInTheDocument();
    expect(within(owed).getByText('2 invoices · 1 clients')).toBeInTheDocument();
    const overdue = screen.getByRole('region', { name: 'Overdue' });
    expect(within(overdue).getByText(/^IDR/)).toBeInTheDocument();
    expect(within(overdue).getByText(/10% IDR/)).toBeInTheDocument();
  });

  it('compares actual received cash month over month and excludes cancelled or scheduled rows', () => {
    renderPage();
    const cash = screen.getByRole('region', { name: 'Received this month' });
    expect(within(cash).getByText(/100/)).toBeInTheDocument();
    expect(within(cash).getByText(/60/)).toBeInTheDocument();
    expect(within(cash).queryByText(/999/)).not.toBeInTheDocument();
  });

  it('keeps the invoices and payments view in the URL', async () => {
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=payments&todo=unapplied');
    expect(screen.getByRole('tab', { name: /Payments received · 4/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /Invoices · 2/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?todo=unapplied');
  });

  it('hides New invoice for an Executive', () => {
    h.role = 'Executive';
    renderPage();
    expect(screen.queryByRole('button', { name: /New invoice/i })).not.toBeInTheDocument();
  });
});
