import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
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

function Query() { return <output data-testid="query">{useLocation().search}</output>; }
const renderTimeline = (entry = '/') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Query />
    <ProcurementTimeline
      procurement={procurement}
      ledgerRows={[]}
      linkedDocuments={[accountingInvoice]}
      isEngineer={false}
      canWriteFiles={false}
      uploadedById={null}
      onFullHistory={() => undefined}
    />
  </MemoryRouter>,
);

describe('Procurement timeline floor controls', () => {
  it('floor: All timeline filter restores status and accounting records', async () => {
    renderTimeline();
    const filters = within(screen.getByRole('group', { name: 'Timeline filter' }));
    await userEvent.click(filters.getByRole('button', { name: 'Financial' }));
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    expect(screen.getByText('PINV-1')).toBeInTheDocument();
    await userEvent.click(filters.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('PINV-1')).toBeInTheDocument();
  });

  it('#2078 the timeline filter is written to the URL, and All leaves it out', async () => {
    renderTimeline();
    const filters = within(screen.getByRole('group', { name: 'Timeline filter' }));
    expect(screen.getByTestId('query').textContent).toBe('');
    await userEvent.click(filters.getByRole('button', { name: 'Financial' }));
    expect(screen.getByTestId('query').textContent).toBe('?timeline=financial');
    await userEvent.click(filters.getByRole('button', { name: 'All' }));
    expect(screen.getByTestId('query').textContent).toBe('');
  });

  it('#2078 a copied link opens the timeline on the filter it names', () => {
    renderTimeline('/?timeline=financial');
    expect(within(screen.getByRole('group', { name: 'Timeline filter' })).getByRole('button', { name: 'Financial' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    expect(screen.getByText('PINV-1')).toBeInTheDocument();
  });
});
