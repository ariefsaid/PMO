import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { ProcurementMoneySummary, ProcurementTimeline } from './ProcurementDetailPanels';

const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const procurement = {
  id: 'p-1', currency: 'USD', total_value: 62_000, created_at: '2026-09-01T00:00:00.000Z',
  requested_by: { full_name: 'Diego Salvatierra' }, statusEvents: [],
  purchase_requests: [], purchase_orders: [], invoices: [], payments: [],
} as unknown as ProcurementDetail;

const overdueInvoice: ErpPurchaseRow = {
  id: 'inv-1', doctype: 'Purchase Invoice', name: 'ACC-PINV-1', supplier: 'SunVolt Modules Co.', docDate: dayOffset(-40),
  dueDate: dayOffset(-13), billNo: 'INV-88213', currency: 'USD', grandTotal: 62_000, netTotal: 62_000, outstanding: 62_000,
  erpStatus: 'Overdue', isReturn: false, projectIds: [], procurementId: 'p-1', linkId: 'l-1',
};

describe('procurement record panels', () => {
  it('L6 + C6: overdue is said once, in Money, and the figures under "USD, before tax" are bare numbers', () => {
    render(
      <>
        <ProcurementMoneySummary procurement={procurement} linkedDocuments={[overdueInvoice]} isEngineer={false} budgetSignal={null} />
        <ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[overdueInvoice]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} />
      </>,
    );

    const money = screen.getByTestId('procurement-money-summary');
    expect(within(money).getByText(/Money · USD, before tax/)).toBeInTheDocument();
    expect(within(money).getByText(/Overdue 13 days/)).toBeInTheDocument();
    expect(within(money).getAllByText('62,000').length).toBeGreaterThan(0);
    expect(money).not.toHaveTextContent('$');

    const row = screen.getAllByTestId('procurement-timeline-row').find((item) => /Supplier invoice/.test(item.textContent ?? '')) as HTMLElement;
    const summary = row.querySelector('summary') as HTMLElement;
    // Date and amount are the glance; the money card owns "overdue", so the row summary does not restate it.
    expect(summary).toHaveTextContent('$62,000');
    expect(summary).toHaveTextContent('Supplier invoice');
    expect(summary).not.toHaveTextContent(/Overdue|Due/);
  });

  it('P5: the timeline note and the Full history link are both reachable and the link still works', async () => {
    const onFullHistory = vi.fn();
    render(<ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={onFullHistory} />);

    expect(screen.getByText(/in date order/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Full history' }));
    expect(onFullHistory).toHaveBeenCalledTimes(1);
  });
});
