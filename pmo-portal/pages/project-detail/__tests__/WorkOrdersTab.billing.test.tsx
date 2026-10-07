import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

const h = vi.hoisted(() => ({
  list: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  billing: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  route: 'external' as 'external' | 'pmo',
  role: 'Finance' as string,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => h.list,
  useProjectDrawdown: () => ({ data: { committed: 0, draft: 0, ceiling: 1_000_000, currency: 'USD', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    setValue: { mutateAsync: vi.fn(), isPending: false }, transition: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.billing }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/adapterSeam/ownershipCache')>()),
  routeDomainWrite: () => h.route,
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: h.role }) }));
vi.mock('../InvoiceWorkOrderModal', () => ({
  default: ({ workOrder, remaining, clientId }: { workOrder: { id: string }; remaining: number; clientId: string }) => (
    <div data-testid="invoice-modal">{`${workOrder.id}|${remaining}|${clientId}`}</div>
  ),
}));

import WorkOrdersTab from '../tabs/WorkOrdersTab';

const wo = (over: Partial<WorkOrderRow> = {}): WorkOrderRow => ({
  id: 'wo-1', org_id: 'org-1', project_id: 'p1', wo_number: 'WO-1', client_po_number: 'PO-77', title: 'Phase 1 fabrication',
  description: null, status: 'Issued', order_value: 500_000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0,
  tax_rate: null, tax_template: null, tax_base_numerator: 1, tax_base_denominator: 1, order_date: '2026-08-01',
  start_date: null, end_date: null, order_value_set_by: 'u-2', order_value_set_at: '2026-08-01T00:00:00Z',
  issued_by: 'u-3', issued_at: '2026-08-02T00:00:00Z', over_commit_ack_by: null, over_commit_ack_at: null,
  closed_at: null, cancelled_at: null, created_at: '2026-08-01T00:00:00Z', ...over,
}) as WorkOrderRow;
const bill = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 500_000, invoiced: 330_000,
  pending: 90_000, paid: 100_000, remaining: 80_000, figuresComplete: true, lineCount: 6, unpaidCount: 3, ...over,
});
const renderTab = (role: Role = 'Finance', clientId: string | null = 'c-1') => {
  h.role = role;
  return render(<ToastProvider><WorkOrdersTab projectId="p1" currency="USD" clientId={clientId} /></ToastProvider>);
};

beforeEach(() => {
  h.list.data = [wo()];
  h.billing = { data: [bill()], isPending: false, isError: false, refetch: vi.fn() };
  h.route = 'external';
});

describe('WorkOrdersTab — billing by work order (OD-BILL-1)', () => {
  it("AC-BWO-004 Finance sees the work order's billing status with invoiced, paid and still to invoice, excl. PPN", () => {
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Partly invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Invoiced $330,000.00 · paid $100,000.00 excl. PPN');
    expect(cell).toHaveTextContent('Still to invoice $80,000.00 excl. PPN');
  });

  it.each([
    ['Paid', bill({ invoiced: 500_000, pending: 0, paid: 500_000, remaining: 0, unpaidCount: 0 }), 'Paid'],
    ['Fully invoiced', bill({ invoiced: 500_000, pending: 0, remaining: 0, unpaidCount: 2 }), 'Fully invoiced'],
    ['Not invoiced', bill({ invoiced: 0, pending: 0, paid: 0, remaining: 500_000, lineCount: 0, unpaidCount: 0 }), 'Not invoiced'],
    ["Can't total", bill({ figuresComplete: false }), "Can't total"],
  ])('AC-BWO-004 shows %s', (_label, row, pill) => {
    h.billing.data = [row];
    renderTab();
    expect(within(screen.getByTestId('wo-billing-wo-1')).getByText(pill)).toBeInTheDocument();
  });

  it("AC-BWO-003 a work order that is full only because of a draft not yet submitted shows the draft amount, never a bare 'Fully invoiced'", () => {
    h.billing.data = [bill({ invoiced: 0, pending: 500_000, paid: 0, remaining: 0, unpaidCount: 0 })];
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Fully invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('In draft $500,000.00 excl. PPN');
    expect(screen.getByTestId('wo-billing-total-draft')).toHaveTextContent('$500,000.00excl. PPN');
  });

  it('AC-BWO-003 with nothing in draft, no draft line or total is shown', () => {
    h.billing.data = [bill({ pending: 0, remaining: 170_000 })];
    renderTab();
    expect(screen.getByTestId('wo-billing-wo-1')).not.toHaveTextContent('In draft');
    expect(screen.queryByTestId('wo-billing-total-draft')).toBeNull();
  });

  it('AC-BWO-004 an over-invoiced work order states the excess', () => {
    h.billing.data = [bill({ remaining: -1_000 })];
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Over-invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Over by $1,000.00 excl. PPN');
  });

  it('AC-BWO-004 Finance gets Invoice on an Issued work order with something left; it opens the dialog with what is left', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Invoice' }));
    expect(screen.getByTestId('invoice-modal')).toHaveTextContent('wo-1|80000|c-1');
  });

  it('AC-BWO-004 a Closed work order with something left can still be invoiced (DD-BWO-7)', () => {
    h.list.data = [wo({ status: 'Closed' })];
    h.billing.data = [bill({ status: 'Closed' })];
    renderTab();
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeInTheDocument();
  });

  it.each([
    ['a Project Manager', () => {}, 'Project Manager' as Role, 'c-1'],
    ['no project client', () => {}, 'Finance' as Role, null],
    ['revenue not on ERPNext', () => { h.route = 'pmo'; }, 'Finance' as Role, 'c-1'],
    ['nothing left', () => { h.billing.data = [bill({ remaining: 0, pending: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['a Draft work order', () => { h.list.data = [wo({ status: 'Draft' })]; h.billing.data = [bill({ status: 'Draft', invoiced: 0, pending: 0, remaining: 500_000, lineCount: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['figures that cannot be totalled', () => { h.billing.data = [bill({ figuresComplete: false })]; }, 'Finance' as Role, 'c-1'],
  ])('AC-BWO-004 no Invoice for %s', (_label, arrange, role, clientId) => {
    arrange();
    renderTab(role, clientId);
    expect(screen.queryByRole('button', { name: 'Invoice' })).toBeNull();
  });

  it('AC-UNB-002 the project totals add Issued and Closed work orders; an over-invoiced one adds nothing left', () => {
    h.list.data = [wo(), wo({ id: 'wo-2', status: 'Closed', wo_number: 'WO-2' }), wo({ id: 'wo-3', status: 'Draft', wo_number: null })];
    h.billing.data = [
      bill(),
      bill({ workOrderId: 'wo-2', status: 'Closed', invoiced: 105_000, pending: 0, paid: 0, remaining: -5_000 }),
      bill({ workOrderId: 'wo-3', status: 'Draft', invoiced: 0, pending: 0, paid: 0, remaining: 900_000, lineCount: 0, unpaidCount: 0 }),
    ];
    renderTab();
    expect(screen.getByTestId('wo-billing-total-invoiced')).toHaveTextContent('$435,000.00excl. PPN');
    expect(screen.getByTestId('wo-billing-total-paid')).toHaveTextContent('$100,000.00excl. PPN');
    expect(screen.getByTestId('wo-billing-total-still')).toHaveTextContent('$80,000.00excl. PPN');
  });

  it('AC-UNB-002 one untotallable work order makes the project totals Unavailable, never a sum', () => {
    h.billing.data = [bill({ figuresComplete: false })];
    renderTab();
    expect(screen.getByTestId('wo-billing-total-still')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('wo-billing-total-still')).not.toHaveTextContent('$');
  });

  it('NFR-BWO-005 while billing loads, each row shows the loading skeleton, never a bare ellipsis or a zero', () => {
    h.billing = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    renderTab();
    const loading = screen.getByTestId('wo-billing-loading-wo-1');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelector('.skel')).not.toBeNull();
    expect(screen.queryByText('…')).toBeNull();
  });

  it('AC-BWO-004 an Engineer sees no billing', () => {
    renderTab('Engineer');
    expect(screen.queryByTestId('wo-billing-summary')).toBeNull();
    expect(screen.queryByTestId('wo-billing-wo-1')).toBeNull();
  });

  it('NFR-BWO-005 a failed billing read shows an error, never a zero', () => {
    h.billing = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("Couldn't load billing for these work orders")).toBeInTheDocument();
    expect(screen.queryByTestId('wo-billing-total-still')).toBeNull();
  });
});

describe('WorkOrdersTab — billing stays in view beside the record panel (OD-BILL-1 layout)', () => {
  const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
  const header = (name: string) => screen.getAllByRole('columnheader').find((th) => th.textContent?.trim() === name)!;

  it('AC-BWO-004 Billing sits right after the work order and its value; the scope rides under the WO number', () => {
    renderTab();
    expect(headers()).toEqual(['WO number', 'Order value', 'Billing', 'Status', 'Order date', 'Actions']);
    const firstCell = screen.getAllByRole('row')[1].querySelector('td')!;
    expect(within(firstCell).getByText('WO-1')).toBeInTheDocument();
    expect(within(firstCell).getByText('Phase 1 fabrication')).toBeInTheDocument();
  });

  it('AC-BWO-004 where the Status column is hidden, the status still shows under the WO number', () => {
    h.list.data = [wo({ status: 'Cancelled' })];
    renderTab();
    const firstCell = screen.getAllByRole('row')[1].querySelector('td')!;
    // Folded copy: shown only while the table is too narrow for the Status column, and never on a mobile card
    // (the card already lists Status as a field).
    expect(within(firstCell).getByText('Cancelled').closest('.\\@2xl\\:hidden')).toHaveClass('max-md:hidden');
  });

  it('AC-BWO-004 secondary columns hide on the table’s own width, never Billing or Actions', () => {
    renderTab();
    // The table sizes off its own container (DESIGN.md: a record-layout column is narrower than the viewport implies).
    expect(screen.getByRole('table').closest('.\\@container')).not.toBeNull();
    expect(header('Status')).toHaveClass('hidden', '@2xl:table-cell');
    expect(header('Order date')).toHaveClass('hidden', '@4xl:table-cell');
    for (const always of ['WO number', 'Order value', 'Billing', 'Actions']) expect(header(always)).not.toHaveClass('hidden');
  });
});
