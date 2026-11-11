import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ReceiptRecord } from './ReceiptRecord';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import type { ReceiptAllocation } from '@/src/lib/revenue/receiptAllocation';

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
    expect(screen.getByText('Receipt total')).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Receipt, not numbered yet');
    expect(screen.queryByText(/c5000000/)).toBeNull();
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
