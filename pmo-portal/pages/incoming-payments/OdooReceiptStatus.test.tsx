import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'jest-axe';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { OdooReceiptStatus } from './OdooReceiptStatus';

const receipt = (overrides: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'receipt-1', org_id: 'org-1', customer_id: null, customer_name: 'Example customer',
  sales_invoice_id: null, ip_number: 'RCP-01', reference_number: null, date: '2026-10-01',
  amount: 123.45, currency: 'IDR', status: 'Scheduled', erp_docstatus: null, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

describe('Odoo receipt status copy', () => {
  it('AC-OCI-090 labels an Odoo paid or reconciled receipt Paid', () => {
    render(<OdooReceiptStatus receipt={receipt({ status: 'Paid', push_command_state: 'confirmed' })} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByText('Received')).toBeNull();
  });

  it('AC-OCI-090 labels a receipt being sent Receipt sent, awaiting Odoo', () => {
    render(<OdooReceiptStatus receipt={receipt({ push_command_state: 'committing' })} />);
    expect(screen.getByText('Receipt sent, awaiting Odoo')).toBeInTheDocument();
  });

  it('AC-OCI-090 shows needs attention for canceled or rejected Odoo reads', () => {
    render(<OdooReceiptStatus receipt={receipt({ erp_cancelled_at: '2026-10-02T00:00:00Z' })} />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).toBeNull();
  });

  it('keeps the existing label for receipts without an Odoo outcome', () => {
    render(<OdooReceiptStatus receipt={receipt()} fallback={<span>Expected</span>} />);
    expect(screen.getByText('Expected')).toBeInTheDocument();
  });

  it.each([
    ['paid', { status: 'Paid', push_command_state: 'confirmed' }],
    ['awaiting', { push_command_state: 'committing' }],
    ['attention', { erp_cancelled_at: '2026-10-02T00:00:00Z' }],
  ] as const)('AC-OCI-092 the %s pill has no axe violations', async (_name, overrides) => {
    const { container } = render(<OdooReceiptStatus receipt={receipt(overrides)} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
