import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ReceiptRecord } from './ReceiptRecord';
import { formatDay } from '@/src/lib/format';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import type { ReceiptAllocation } from '@/src/lib/revenue/receiptAllocation';
import enCommon from '@/public/locales/en/common.json';
import idCommon from '@/public/locales/id/common.json';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="record-link-location">{location.pathname}{location.search}</output>;
}

describe('ReceiptRecord', () => {
  it('keeps receipt evidence and applied allocation amounts exact to cents for reconciliation', () => {
    const receipt = {
      id: 'receipt-1', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-01', reference_number: null, date: '2026-10-01',
      amount: 123.45, currency: 'USD', status: 'Paid', erp_docstatus: 1, erp_modified: null,
      erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z',
      received_amount: 123.45, withheld_amount: 0,
    } as IncomingPaymentRow;
    const allocations: ReceiptAllocation[] = [
      { invoice_id: 'invoice-1', invoice_number: 'INV-01', amount: '123.45', currency: 'USD' },
    ];

    render(
      <MemoryRouter>
        <ReceiptRecord receipt={receipt} allocations={allocations} onBack={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('$123.45')).toHaveLength(2);
    expect(screen.queryByText('$123')).not.toBeInTheDocument();
  });

  it('AC-OCI-091 shows settled, cash and withheld figures only when the Odoo receipt includes withholding', () => {
    const receipt = {
      id: 'receipt-2', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-02', reference_number: null, date: '2026-10-01',
      amount: 123.45, currency: 'IDR', status: 'Paid', erp_docstatus: 1, erp_modified: null,
      erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z',
      received_amount: 100, withheld_amount: 23.45, withholding_slip_number: 'SLIP-2',
    } as IncomingPaymentRow;
    const { rerender } = render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[]} onBack={() => {}} odoo /></MemoryRouter>);
    expect(screen.getByText('Payment total')).toBeInTheDocument();
    expect(screen.getByText('Cash received')).toBeInTheDocument();
    expect(screen.getByText('Tax withheld')).toBeInTheDocument();
    rerender(<MemoryRouter><ReceiptRecord receipt={{ ...receipt, received_amount: 123.45, withheld_amount: 0, withholding_slip_number: null }} allocations={[]} onBack={() => {}} odoo /></MemoryRouter>);
    expect(screen.queryByText('Cash received')).toBeNull();
    expect(screen.queryByText('Tax withheld')).toBeNull();
  });

  it('AC-OCI-090 shows Odoo receipt waiting and refusal outcomes plainly', () => {
    const receipt = {
      id: 'receipt-3', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-03', reference_number: null, date: '2026-10-01',
      amount: 123.45, currency: 'IDR', status: 'Scheduled', erp_docstatus: null, erp_modified: null,
      erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z',
      push_command_state: 'committing', received_amount: 123.45, withheld_amount: 0,
    } as IncomingPaymentRow;
    const { rerender } = render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[]} onBack={() => {}} odoo /></MemoryRouter>);
    expect(screen.getByText('Receipt sent, awaiting Odoo')).toBeInTheDocument();
    rerender(<MemoryRouter><ReceiptRecord receipt={{ ...receipt, erp_cancelled_at: '2026-10-02T00:00:00Z' }} allocations={[]} onBack={() => {}} odoo /></MemoryRouter>);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).toBeNull();
    rerender(<MemoryRouter><ReceiptRecord receipt={{ ...receipt, push_command_state: 'failed' }} allocations={[]} onBack={() => {}} odoo /></MemoryRouter>);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('review: an Odoo receipt without a number yet is titled plainly, never by its internal id', () => {
    const receipt = {
      id: 'c5000000-0000-0000-0000-000000000003', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: null, reference_number: null, date: '2026-10-01', amount: 100, currency: 'USD',
      status: 'Scheduled', erp_docstatus: null, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
      created_at: '2026-10-01T00:00:00Z', received_amount: 100, withheld_amount: 0, push_command_state: 'pending',
    } as IncomingPaymentRow;
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={null} onBack={() => {}} odoo /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Incoming payment, not numbered yet');
    expect(screen.queryByText(/c5000000/)).toBeNull();
  });

  it('uses Payment received as the title and keeps the receipt number', () => {
    const receipt = {
      id: 'receipt-4', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-04', reference_number: null, date: '2026-10-01', amount: 100,
      currency: 'USD', status: 'Paid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
      erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z', received_amount: 100, withheld_amount: 0,
    } as IncomingPaymentRow;
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[]} onBack={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Incoming payment RCP-04');
  });

  it.each([
    { state: 'Expected', status: 'Scheduled' },
    { state: 'Paid', status: 'Paid' },
    { state: 'Cancelled', status: 'Paid', cancelled_at: '2026-10-02T00:00:00Z' },
  ])('C3 titles the $state record as an incoming payment', ({ state, ...statusFields }) => {
    const receipt = {
      id: `receipt-${state.toLowerCase()}`, org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: `RCP-${state.toUpperCase()}`, reference_number: null, date: '2026-10-01', amount: 100,
      currency: 'USD', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
      erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z', received_amount: 100, withheld_amount: 0,
      ...statusFields,
    } as IncomingPaymentRow;
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[]} onBack={() => {}} /></MemoryRouter>);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/^Incoming payment/);
    expect(heading).not.toHaveTextContent(/received/i);
  });

  it('uses the shared record header for receipt identity, status, client, date, and total', () => {
    const receipt = {
      id: 'receipt-5', org_id: 'org-1', customer_id: 'client-1', customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-05', reference_number: null, date: '2026-10-01', amount: 100,
      currency: 'USD', status: 'Paid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
      erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z', received_amount: 90, withheld_amount: 10,
      withholding_article: 'pph23',
    } as IncomingPaymentRow;
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[]} onBack={() => {}} /></MemoryRouter>);

    const header = screen.getByTestId('record-header');
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('Incoming payment RCP-05');
    expect(header).toHaveTextContent('Received');
    expect(header).toHaveTextContent('Example customer');
    expect(header).toHaveTextContent('Date');
    expect(header).toHaveTextContent(formatDay('2026-10-01'));
    expect(header).toHaveTextContent('Payment total');
    expect(header).toHaveTextContent('$100.00');
    expect(screen.getByRole('heading', { name: 'Invoices this payment settled' })).toBeInTheDocument();
    expect(screen.getByText('Cash received')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-withheld')).toHaveTextContent('$10.00');
    expect(screen.getByTestId('receipt-withholding-article')).toHaveTextContent('PPh 23');
    expect(screen.getByTestId('receipt-unapplied')).toHaveTextContent('$100.00');
  });

  it('shows each missing receipt figure as a labelled not reported fact in the header', () => {
    const receipt = {
      id: 'receipt-missing', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-MISSING', reference_number: null, date: '2026-10-01',
      amount: null, currency: 'USD', status: 'Paid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
      erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z', received_amount: null, withheld_amount: null,
    } as IncomingPaymentRow;
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={null} onBack={() => {}} /></MemoryRouter>);

    const header = screen.getByTestId('record-header');
    for (const label of ['Payment total', 'Cash received', 'Tax withheld', 'Not yet applied']) {
      const fact = within(header).getByText(label).parentElement!;
      expect(within(fact).getByText('Not reported')).toBeInTheDocument();
    }
    expect(within(header).getAllByText('Not reported')).toHaveLength(4);
    expect(screen.queryByText(/^Not reported:/)).not.toBeInTheDocument();
  });

  it('opens the client invoice list with the list-supported customer filter', async () => {
    const user = userEvent.setup();
    const receipt = {
      id: 'receipt-client', org_id: 'org-1', customer_id: 'client-42', customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-CLIENT', reference_number: null, date: '2026-10-01', amount: 100,
      currency: 'USD', status: 'Paid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
      erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z', received_amount: 100, withheld_amount: 0,
    } as IncomingPaymentRow;
    render(
      <MemoryRouter initialEntries={['/incoming-payments/receipt-client']}>
        <Routes>
          <Route path="/incoming-payments/:receiptId" element={<ReceiptRecord receipt={receipt} allocations={[]} onBack={() => {}} />} />
          <Route path="/finance/receivables" element={<p>Client invoices</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link', { name: "Open client's invoices" }));

    expect(screen.getByText('Client invoices')).toBeInTheDocument();
    expect(screen.getByTestId('record-link-location')).toHaveTextContent('/finance/receivables?view=invoices&customer=client-42');
  });

  it.each([
    {
      language: 'en',
      coverageUnknown: 'The accounting system has not reported which invoices this payment settled.',
      onAccount: 'This payment is not applied to any invoice. The cash is held on account.',
    },
    {
      language: 'id',
      coverageUnknown: 'Sistem akuntansi belum melaporkan faktur mana yang dilunasi pembayaran ini.',
      onAccount: 'Pembayaran ini tidak dialokasikan ke faktur mana pun. Uangnya ditahan sebagai titipan.',
    },
  ])('uses payment wording for the two allocation messages in $language', async ({ language, coverageUnknown, onAccount }) => {
    const i18n = createInstance();
    await i18n.init({
      lng: language,
      fallbackLng: false,
      defaultNS: 'common',
      resources: { en: { common: enCommon }, id: { common: idCommon } },
      interpolation: { escapeValue: false },
      initImmediate: false,
      react: { useSuspense: false },
    });
    const receipt = {
      id: 'receipt-copy', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-COPY', reference_number: null, date: '2026-10-01',
      amount: 100, currency: 'USD', status: 'Paid', erp_docstatus: 1, erp_modified: null,
      erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z',
      received_amount: 100, withheld_amount: 0,
    } as IncomingPaymentRow;
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><ReceiptRecord receipt={receipt} allocations={null} onBack={() => {}} /></MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText(coverageUnknown)).toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><ReceiptRecord receipt={receipt} allocations={[]} onBack={() => {}} /></MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText(onAccount)).toBeInTheDocument();
  });

  it('AC-WHA-006: a receipt with tax withheld names its withholding article, or says it was not stated', () => {
    const base = {
      id: 'receipt-3', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
      sales_invoice_id: null, ip_number: 'RCP-03', reference_number: null, date: '2026-10-01',
      amount: 1000, currency: 'IDR', status: 'Paid', erp_docstatus: 1, erp_modified: null,
      erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z',
      received_amount: 980, withheld_amount: 20, withholding_slip_number: 'SLIP-3',
    } as IncomingPaymentRow;
    const { rerender } = render(<MemoryRouter><ReceiptRecord receipt={{ ...base, withholding_article: 'pph4_2' }} allocations={[]} onBack={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('receipt-withholding-article')).toHaveTextContent('PPh 4(2)');
    rerender(<MemoryRouter><ReceiptRecord receipt={{ ...base, withholding_article: null }} allocations={[]} onBack={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('receipt-withholding-article')).toHaveTextContent('Not stated');
    rerender(<MemoryRouter><ReceiptRecord receipt={{ ...base, withheld_amount: 0 }} allocations={[]} onBack={() => {}} /></MemoryRouter>);
    expect(screen.queryByTestId('receipt-withholding-article')).not.toBeInTheDocument();
  });
});
