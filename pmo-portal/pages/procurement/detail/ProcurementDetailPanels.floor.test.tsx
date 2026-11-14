import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { ProcurementTimeline } from './ProcurementDetailPanels';

const procurement = {
  id: 'proc-1', currency: 'USD', total_value: 62000, created_at: '2026-09-01T00:00:00.000Z',
  requested_by: { full_name: 'Requester' },
  statusEvents: [{ id: 'event-1', created_at: '2026-09-02T00:00:00.000Z', to_status: 'Approved', notes: null }],
  purchase_requests: [], purchase_orders: [], invoices: [], payments: [],
} as unknown as ProcurementDetail;

const accountingInvoice: ErpPurchaseRow = {
  id: 'invoice-1', doctype: 'Purchase Invoice', name: 'PINV-1', supplier: 'Supplier One',
  docDate: '2026-09-03', dueDate: null, billNo: null, currency: 'USD', grandTotal: 62000,
  netTotal: 60000, outstanding: 62000, erpStatus: 'Unpaid', isReturn: false,
  projectIds: [], procurementId: 'proc-1', linkId: 'link-1',
};

describe('Procurement timeline floor controls', () => {
  it('floor: All timeline filter restores status and accounting records', async () => {
    render(<ProcurementTimeline
      procurement={procurement}
      ledgerRows={[]}
      linkedDocuments={[accountingInvoice]}
      isEngineer={false}
      canWriteFiles={false}
      uploadedById={null}
      onFullHistory={() => undefined}
    />);
    const filters = within(screen.getByRole('group', { name: 'Timeline filter' }));
    await userEvent.click(filters.getByRole('button', { name: 'Financial' }));
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    expect(screen.getByText('PINV-1')).toBeInTheDocument();
    await userEvent.click(filters.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('PINV-1')).toBeInTheDocument();
  });
});
