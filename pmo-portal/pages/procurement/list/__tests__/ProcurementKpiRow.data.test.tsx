import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { ProcurementKpiRow } from '../ProcurementKpiRow';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-20', isPending: false, isError: false, retry: vi.fn() }) }));

/**
 * The KPI row is memoised on (rows, role) so the page's per-query-settle re-renders skip it.
 * The contract that keeps that safe: when ITS data changes, the tile's figures change with it.
 */
const row = (id: string, status: string, invoiced: number): ProcurementWithRefs => ({
  id, code: `VI-${id}`, title: `Row ${id}`, status, total_value: invoiced, approved_total_value: null, currency: 'USD',
  project_id: 'p-1', budget_category: null, requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', status_events: [],
  project: null, vendor: null, requested_by: null,
  procurement_invoices: [{ id: `inv-${id}`, invoice_date: '2026-10-02', created_at: '2026-10-02T00:00:00.000Z', amount: invoiced, total_value: invoiced, status: 'Recorded' }],
} as unknown as ProcurementWithRefs);

describe('ProcurementKpiRow (memoised) data contract', () => {
  it('shows the figures of the rows it was given, and follows new query data', () => {
    const oneUnpaid = [row('a', 'Vendor Invoiced', 5_000)];
    const { rerender } = render(<ProcurementKpiRow rows={oneUnpaid} role="Finance" />);
    expect(screen.getByText(/^1 procurement/)).toBeInTheDocument();
    expect(screen.getByTestId('summary-total-unpaid')).toHaveTextContent('$5K');

    // The query settles again with a second supplier invoice in scope.
    rerender(<ProcurementKpiRow rows={[...oneUnpaid, row('b', 'Vendor Invoiced', 7_000)]} role="Finance" />);

    expect(screen.getByText(/^2 procurements/)).toBeInTheDocument();
    expect(screen.getByTestId('summary-total-unpaid')).toHaveTextContent('$12K');
  });

  it('uses the invoice date for the oldest supplier-invoice age, with no recorded-date fallback', () => {
    const { rerender } = render(<ProcurementKpiRow rows={[row('a', 'Vendor Invoiced', 5_000)]} role="Finance" />);
    expect(screen.getByText(/Invoice age 18 days/)).toBeInTheDocument();

    const noInvoiceDate = { ...row('b', 'Vendor Invoiced', 7_000), procurement_invoices: [{
      id: 'inv-b', invoice_date: null, created_at: '2026-10-02T00:00:00.000Z', amount: 7_000, total_value: 7_000, status: 'Recorded',
    }] } as unknown as ProcurementWithRefs;
    rerender(<ProcurementKpiRow rows={[noInvoiceDate]} role="Finance" />);
    expect(screen.queryByText(/Invoice age/)).not.toBeInTheDocument();
  });

  it('re-renders when the viewer changes, so an engineer never keeps the money tiles', () => {
    const rows = [row('a', 'Vendor Invoiced', 5_000)];
    const { rerender } = render(<ProcurementKpiRow rows={rows} role="Finance" />);
    expect(screen.getByTestId('summary-total-unpaid')).toBeInTheDocument();

    rerender(<ProcurementKpiRow rows={rows} role="Engineer" />);

    expect(screen.queryByTestId('summary-total-unpaid')).not.toBeInTheDocument();
    expect(screen.queryByText('Supplier invoices unpaid')).not.toBeInTheDocument();
  });
});
