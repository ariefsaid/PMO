import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  role: 'Finance' as 'Finance' | 'Executive',
  invoices: [] as unknown[],
  payments: [] as unknown[],
  position: {
    receivablesCount: 0, receivablesUnknownCount: 0, overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
    unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: {}, payablesUnknownCount: 0,
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
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string) => h.role !== 'Executive' || action === 'view',
}));
vi.mock('@/pages/SalesInvoices', () => ({ default: () => null }));
vi.mock('@/pages/IncomingPayments', () => ({ default: () => null }));

import ReceivablesPage from '../finance/ReceivablesPage';

const invoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'invoice-1', org_id: 'org-1', project_id: 'project-1', erp_project: null, billing_kind: 'contract',
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
    receivablesCount: 2, receivablesUnknownCount: 0,
    overdue: [{ invoice: invoice({ id: 'overdue', erp_outstanding_amount: 10 }), daysOverdue: 5, outstanding: 1000 }],
    overdueTotals: { IDR: 1000 }, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [], unappliedPayments: [], unappliedTotals: {},
    payables: [], payablesTotals: {}, payablesUnknownCount: 0,
    receivablesAgeing: { IDR: { notDue: 8000, d1_30: 1000, d31_60: 0, d61_90: 0, over90: 1000 } },
    payablesAgeing: {},
  };
  await financeTestI18n.changeLanguage('en');
});

// A figure tile: its label sits in the head row, the tile root is the head's parent.
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement as HTMLElement;

describe('Receivables page', () => {
  it('R2-P1b #4 explains that an unknown invoice balance was not reported', () => {
    h.invoices = [invoice({ erp_outstanding_amount: null })];
    h.position = {
      ...h.position,
      receivablesAgeing: {},
      receivablesUnknownCount: 1,
      overdueTotals: {},
      overdueUnknownCount: 1,
      overdue: [{ invoice: invoice({ erp_outstanding_amount: null }), daysOverdue: 119, outstanding: null }],
    };

    renderPage();

    expect(screen.getByRole('region', { name: /Client balances by age/ }))
      .toHaveTextContent('1 invoice has no balance reported by the accounting system');
    expect(screen.getByRole('region', { name: /Client balances by age/ })).not.toHaveTextContent('No balances');
  });

  it('shows zero for an empty due window and no payments this month', () => {
    h.invoices = [];
    h.payments = [];
    h.position = { ...h.position, receivablesCount: 0, receivablesAgeing: {}, overdue: [], overdueTotals: {} };
    renderPage();
    for (const label of ['Owed to you', 'Overdue', 'Due in next 30 days', 'Received this month']) {
      expect(tile(label)).toHaveTextContent(/IDR\s*0/);
    }
  });

  it('hides unknown owed and overdue figures and says why once, in one page line', () => {
    h.invoices = [invoice({ erp_outstanding_amount: null })];
    h.position = { ...h.position, receivablesAgeing: {}, receivablesUnknownCount: 1, overdueTotals: {}, overdueUnknownCount: 1,
      overdue: [{ invoice: invoice({ erp_outstanding_amount: null }), daysOverdue: 5, outstanding: null }] };
    renderPage();
    expect(screen.queryByText('Owed to you')).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('3 figures hidden: 1 invoice has no balance reported by the accounting system');
    expect(screen.getByRole('region', { name: /Client balances by age/ })).toHaveTextContent(/no balance reported by the accounting system/i);
    // The overdue filter in the list is the one way in; no second "N overdue" line sits above it.
    expect(screen.queryByTestId('receivables-overdue-row')).toBeNull();
    expect(screen.queryByText(/Show all \d+ overdue/)).toBeNull();
  });

  it('uses the shared ageing and overdue totals; counts stay out of the money tiles', () => {
    renderPage();
    expect(tile('Owed to you')).toHaveTextContent(/IDR\s*100/);
    expect(tile('Owed to you')).toHaveTextContent('tax included');
    expect(tile('Owed to you')).not.toHaveTextContent(/invoices?\b/);
    expect(tile('Overdue')).toHaveTextContent(/^Overdue.*IDR/);
    expect(tile('Overdue')).toHaveTextContent('10% of owed');
    expect(screen.queryByTestId('receivables-overdue-row')).toBeNull();
  });

  it('shows whole-unit money for upcoming invoices and puts another currency on its own second line', () => {
    h.invoices = [
      invoice({ erp_outstanding_amount: 1250, amount: 1250 }),
      invoice({ id: 'invoice-usd', si_number: 'SI-USD', currency: 'USD', erp_outstanding_amount: 75, amount: 75 }),
    ];
    h.position = {
      ...h.position,
      receivablesAgeing: {
        IDR: { notDue: 90000, d1_30: 10000, d31_60: 0, d61_90: 0, over90: 0 },
        USD: { notDue: 7500, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 },
      },
      overdueTotals: { IDR: 10000, USD: 5000 },
      overdue: [{ invoice: invoice({ id: 'late-idr' }), daysOverdue: 12, outstanding: 10000 }],
    };

    renderPage();

    expect(tile('Owed to you')).toHaveTextContent(/IDR\s*1,000/);
    const owedOtherCurrency = within(tile('Owed to you')).getByText(/^USD/);
    expect(owedOtherCurrency).toHaveClass('block');
    expect(owedOtherCurrency).not.toHaveTextContent('+');
    expect(tile('Due in next 30 days')).toHaveTextContent(/IDR\s*1,250/);
    expect(tile('Due in next 30 days')).toHaveTextContent(/next due/);
    const dueOtherCurrency = within(tile('Due in next 30 days')).getByText(/^USD/);
    expect(dueOtherCurrency).toHaveClass('block');
    expect(dueOtherCurrency).not.toHaveTextContent('+');
    expect(tile('Overdue')).toHaveTextContent('10% of owed');
  });

  it('compares actual received cash month over month and excludes cancelled or scheduled rows', () => {
    renderPage();
    const cash = tile('Received this month');
    expect(cash).toHaveTextContent(/IDR\s*100/);
    expect(cash).toHaveTextContent(/\+IDR\s*60 vs last month/);
    expect(cash).not.toHaveTextContent(/999/);
  });

  it('O8: an unchanged month carries no sign', () => {
    h.payments = [payment(), payment({ id: 'payment-previous', date: '2026-09-05', amount: 100, received_amount: 100, withheld_amount: 0 })];
    renderPage();
    const delta = within(tile('Received this month')).getByText(/vs last month/);
    expect(delta).not.toHaveTextContent('+');
    expect(delta).not.toHaveTextContent('−');
  });

  it('F11: figure tiles show short amounts with the exact amount kept for screen readers', () => {
    h.position = { ...h.position, receivablesAgeing: { IDR: { notDue: 6_240_000_000, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } } };
    renderPage();
    const strip = screen.getByRole('region', { name: 'Receivables figures' });
    const short = within(strip).getByText('IDR 62.4M');
    expect(short.getAttribute('title')).toMatch(/^IDR\s62,400,000$/);
    expect(within(strip).getByText(/^IDR\s62,400,000$/)).toHaveClass('sr-only');
  });

  it('offers Receive payment from both the invoices and the payments view', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Receive payment' })).toBeInTheDocument();
  });

  it('keeps the invoices and payments view in the URL', async () => {
    const user = userEvent.setup();
    renderPage('/finance/receivables?view=payments&todo=unapplied');
    expect(screen.getByRole('tab', { name: /Payments received · 4/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /Invoices · 2/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?todo=unapplied');
  });

  it('B4: keeps New invoice and Receive payment in the same header on both tabs', async () => {
    const user = userEvent.setup();
    const invoices = renderPage();
    const newInvoice = screen.getByRole('button', { name: /New invoice/i });
    const receivePayment = screen.getByRole('button', { name: 'Receive payment' });
    const headerActions = screen.getByTestId('receivables-header-new-invoice').parentElement!;
    expect(headerActions).toContainElement(newInvoice);
    expect(headerActions).toContainElement(receivePayment);
    await user.click(newInvoice);
    expect(screen.getByTestId('location')).toHaveTextContent('create=1');

    invoices.unmount();
    renderPage('/finance/receivables?view=payments');
    const paymentHeaderActions = screen.getByTestId('receivables-header-new-invoice').parentElement!;
    expect(paymentHeaderActions).toContainElement(screen.getByRole('button', { name: /New invoice/i }));
    expect(paymentHeaderActions).toContainElement(screen.getByRole('button', { name: 'Receive payment' }));
  });

  it('hides New invoice for an Executive', () => {
    h.role = 'Executive';
    renderPage();
    expect(screen.queryByRole('button', { name: /New invoice/i })).not.toBeInTheDocument();
  });
});
