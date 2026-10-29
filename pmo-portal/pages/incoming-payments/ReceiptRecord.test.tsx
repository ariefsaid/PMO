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
});
