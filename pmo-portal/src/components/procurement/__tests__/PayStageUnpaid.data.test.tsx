import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { PayStageUnpaid } from '../PayStageUnpaid';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-20', isPending: false, isError: false, retry: vi.fn() }) }));

/**
 * The unpaid supplier-invoice figure (moved from the summary tiles into the Pay stage chip, #2134) is
 * memoised on (rows, role) so the list's per-keystroke re-renders skip it. The contract that keeps that
 * safe: when ITS data changes, the figure changes with it.
 */
const row = (id: string, status: string, invoiced: number): ProcurementWithRefs => ({
  id, code: `VI-${id}`, title: `Row ${id}`, status, total_value: invoiced, approved_total_value: null, currency: 'USD',
  project_id: 'p-1', budget_category: null, requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', status_events: [],
  project: null, vendor: null, requested_by: null,
  procurement_invoices: [{ id: `inv-${id}`, invoice_date: '2026-10-02', created_at: '2026-10-02T00:00:00.000Z', amount: invoiced, total_value: invoiced, status: 'Recorded' }],
} as unknown as ProcurementWithRefs);

describe('PayStageUnpaid (memoised) data contract', () => {
  it('shows the unpaid balance of the rows it was given, and follows new query data', () => {
    const oneUnpaid = [row('a', 'Vendor Invoiced', 5_000)];
    const { rerender } = render(<PayStageUnpaid rows={oneUnpaid} role="Finance" />);
    expect(screen.getByTestId('summary-total-unpaid')).toHaveTextContent('$5K unpaid');
    expect(screen.getByTestId('summary-total-unpaid')).toHaveAttribute('title', expect.stringContaining('$5,000'));

    // The query settles again with a second supplier invoice in scope.
    rerender(<PayStageUnpaid rows={[...oneUnpaid, row('b', 'Vendor Invoiced', 7_000)]} role="Finance" />);

    expect(screen.getByTestId('summary-total-unpaid')).toHaveTextContent('$12K unpaid');
  });

  it('uses the invoice date for the oldest supplier-invoice age, with no recorded-date fallback', () => {
    const { rerender } = render(<PayStageUnpaid rows={[row('a', 'Vendor Invoiced', 5_000)]} role="Finance" />);
    expect(screen.getByText(/Invoice age 18 days/)).toBeInTheDocument();

    const noInvoiceDate = { ...row('b', 'Vendor Invoiced', 7_000), procurement_invoices: [{
      id: 'inv-b', invoice_date: null, created_at: '2026-10-02T00:00:00.000Z', amount: 7_000, total_value: 7_000, status: 'Recorded',
    }] } as unknown as ProcurementWithRefs;
    rerender(<PayStageUnpaid rows={[noInvoiceDate]} role="Finance" />);
    expect(screen.queryByText(/Invoice age/)).not.toBeInTheDocument();
  });

  it('shows the oldest unpaid invoice age as visible text in the chip, and keeps it in the title', () => {
    render(<PayStageUnpaid rows={[row('a', 'Vendor Invoiced', 5_000)]} role="Finance" />);
    const chip = screen.getByTestId('summary-total-unpaid');
    const visible = screen.getByText('oldest 18 days');
    expect(chip).toContainElement(visible);
    expect(visible.closest('.sr-only')).toBeNull();
    expect(chip).toHaveAttribute('title', expect.stringContaining('Invoice age 18 days'));
  });

  it('says one day in the singular', () => {
    const recent = { ...row('a', 'Vendor Invoiced', 5_000), procurement_invoices: [{
      id: 'inv-a', invoice_date: '2026-10-19', created_at: '2026-10-19T00:00:00.000Z', amount: 5_000, total_value: 5_000, status: 'Recorded',
    }] } as unknown as ProcurementWithRefs;
    render(<PayStageUnpaid rows={[recent]} role="Finance" />);
    expect(screen.getByText('oldest 1 day')).toBeInTheDocument();
  });

  it('re-renders when the viewer changes, so an engineer never keeps the unpaid figure', () => {
    const rows = [row('a', 'Vendor Invoiced', 5_000)];
    const { rerender } = render(<PayStageUnpaid rows={rows} role="Finance" />);
    expect(screen.getByTestId('summary-total-unpaid')).toBeInTheDocument();

    rerender(<PayStageUnpaid rows={rows} role="Engineer" />);

    expect(screen.queryByTestId('summary-total-unpaid')).not.toBeInTheDocument();
    expect(screen.queryByText(/unpaid/)).not.toBeInTheDocument();
  });

  it('says the balance is not recorded rather than showing a figure it does not have', () => {
    const blank = { ...row('c', 'Vendor Invoiced', 0), procurement_invoices: [] } as unknown as ProcurementWithRefs;
    render(<PayStageUnpaid rows={[blank]} role="Finance" />);
    expect(screen.getByTestId('summary-total-unpaid')).toHaveTextContent('unpaid not recorded');
    expect(screen.getByTestId('summary-total-unpaid')).not.toHaveTextContent('$');
  });
});
