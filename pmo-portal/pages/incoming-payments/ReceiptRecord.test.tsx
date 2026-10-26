import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ReceiptRecord } from './ReceiptRecord';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));
const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => viewport.desktop }));
const receipt = { id: 'receipt-1', pmo_number: 'RCV-1', pmo_native: true, customer_name: 'Example customer', date: '2026-10-26', currency: 'IDR', amount: 2226648000, received_amount: 2226648000, withheld_amount: 0, status: 'Paid' } as IncomingPaymentRow;
describe('receipt record decision evidence', () => {
  it('R-018 names the consequential receipt action', () => {
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[]} onBack={vi.fn()} onCancel={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Cancel receipt' })).toBeInTheDocument();
  });
  it('R-019 names a shared allocation currency once while preserving exact applied amounts', () => {
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[
      { invoice_id: 'invoice-1', invoice_number: 'INV-1', amount: '2000000000', currency: 'IDR' },
      { invoice_id: 'invoice-2', invoice_number: 'INV-2', amount: '226648000', currency: 'IDR' },
    ]} onBack={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Applied · IDR/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'INV-1' })).toBeInTheDocument();
    expect(screen.getByText('2,000,000,000')).toBeInTheDocument();
    expect(screen.getByText('226,648,000')).toBeInTheDocument();
  });
  it('R-019 keeps shared Applied/currency context out of the phone allocation rows', () => {
    viewport.desktop = false;
    render(<MemoryRouter><ReceiptRecord receipt={receipt} allocations={[
      { invoice_id: 'invoice-1', invoice_number: 'INV-1', amount: '2000000000', currency: 'IDR' },
      { invoice_id: 'invoice-2', invoice_number: 'INV-2', amount: '226648000', currency: 'IDR' },
    ]} onBack={vi.fn()} /></MemoryRouter>);
    expect(screen.getAllByText(/Applied/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'INV-1' })).toHaveAttribute('href', '/sales-invoices/invoice-1');
    expect(screen.getByText('2,000,000,000')).toBeVisible();
    expect(screen.getByText('226,648,000')).toBeVisible();
    viewport.desktop = true;
  });

});
