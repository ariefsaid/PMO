/** AC-NBR-009: a customer-order card shows the parent's settlement figures and issues no read of its own. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import type { InvoiceWithWorkOrder } from './workOrdersTabFigures';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));
// Their own reads are not this card's invoice/billing reads; stubbed so the cache can only hold the card's.
vi.mock('@/src/components/tasks/WorkOrderOpenTasks', () => ({ WorkOrderOpenTasks: ({ workOrderId }: { workOrderId: string }) => <div>Open tasks for {workOrderId}</div> }));
vi.mock('../WorkOrderAcceptances', () => ({ default: () => null }));
vi.mock('../WorkOrderCostVariations', () => ({ WorkOrderCostVariations: () => null }));

import WorkOrderCustomerOrderCard from './WorkOrderCustomerOrderCard';

const row = { id: 'wo1', wo_number: 'WO-1', title: 'Order one', status: 'Issued', closing_value: null } as unknown as WorkOrderRow;
const invoice = { id: 'inv1', status: 'Submitted', amount: 400, erp_outstanding_amount: 100, work_order_id: 'wo1', invoice_date: '2026-10-01', erp_due_date: '2026-12-01' } as unknown as InvoiceWithWorkOrder;
const billingRow = { workOrderId: 'wo1', projectId: 'p1', status: 'Issued', currency: 'IDR', orderNet: 1000, invoiced: 400, pending: 0, paid: 300, remaining: 600, figuresComplete: true, lineCount: 1, unpaidCount: 1 } as WorkOrderBillingRow;

const read = (over: Partial<{ isPending: boolean; isError: boolean }> = {}) => ({ isPending: false, isError: false, refetch: vi.fn(), ...over });

const card = (over: { invoicesRead?: ReturnType<typeof read>; billingRead?: ReturnType<typeof read> } = {}) => (
  <WorkOrderCustomerOrderCard
    row={row} currency="IDR" canViewBilling orgDay="2026-11-01" boqRows={[]} documentRows={[]} projectManagerId={null}
    allocationsByWo={new Map()} acceptancesByWo={new Map()} invoicesByWo={new Map([['wo1', [invoice]]])}
    billingById={new Map([['wo1', billingRow]])} ageById={new Map()} drawerLineRowsByWo={new Map()}
    contractAllocationsByWo={new Map()} boqById={new Map()} lineReadsPending={false} lineReadsFailed={false}
    invoiceReadReady invoicesRead={over.invoicesRead ?? read()} billingRead={over.billingRead ?? read()}
    contractLines={[]} retryLineReads={vi.fn()} canPrepareForOrder={() => false} orderInvoiceAction={() => null}
    closeByBast={() => false} currentUserId={null} openPoDrawer={vi.fn()} openLineDrawer={vi.fn()} openInvoiceDrawer={vi.fn()}
    setFormFor={vi.fn()} setPending={vi.fn()} setBastFor={vi.fn()} setConfirmFor={vi.fn()} setWithdrawFor={vi.fn()}
    setLinesFor={vi.fn()} acceptancesRead={read()} linesRead={read()}
  />
);

const mount = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
  return client;
};

describe('AC-NBR-009 customer-order card reads come from its parent', () => {
  it('AC-TWOP-009 shows open tasks for this work order', () => {
    mount(card());
    expect(screen.getByText('Open tasks for wo1')).toBeInTheDocument();
  });

  it('shows the settlement figures from the parent data and starts no query of its own', () => {
    const client = mount(card());
    expect(screen.getByTestId('wo-still-wo1')).toHaveTextContent('600');
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.isFetching()).toBe(0);
  });

  it('(P) the parent billing read pending: figures wait on it, the loading note shows, still no own read', () => {
    const client = mount(card({ billingRead: read({ isPending: true }) }));
    expect(screen.getByText('Invoice figures are loading.')).toBeInTheDocument();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('(F) the parent billing read failed: the card says so and Retry calls the parent reads', async () => {
    const billingRead = read({ isError: true });
    const invoicesRead = read();
    mount(card({ billingRead, invoicesRead }));
    expect(screen.getByText("Couldn't load billing for these work orders")).toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry invoice figures' }).click();
    expect(billingRead.refetch).toHaveBeenCalled();
    expect(invoicesRead.refetch).toHaveBeenCalled();
  });
});
