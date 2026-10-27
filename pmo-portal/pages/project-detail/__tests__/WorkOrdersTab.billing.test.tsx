import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import type { Role } from '@/src/auth/AuthContext';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

const h = vi.hoisted(() => ({
  list: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  billing: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  boq: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  projectBilling: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  orderLines: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  claims: [] as unknown[],
  mode: 'erp' as 'erp' | 'native' | undefined,
  routeReady: true,
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
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => h.boq,
  useProjectBilling: () => h.projectBilling,
  useProjectClaims: () => ({ data: h.claims, isPending: false, isError: false, refetch: vi.fn() }),
  useProgressBillingMutations: () => ({}),
}));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrderLines: () => h.orderLines,
  useWorkOrderAcceptances: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptanceMutations: () => ({}),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.billing }));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => h.invoices }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.mode }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: (mode: unknown) => h.routeReady && mode !== undefined }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: h.role }) }));
vi.mock('../InvoiceWorkOrderModal', () => ({
  default: ({ workOrder, remaining, clientId, onCreated }: { workOrder: { id: string }; remaining: number; clientId: string; onCreated: (invoice: { id: string; si_number: string | null }) => void }) => (
    <div data-testid="invoice-modal">
      {`${workOrder.id}|${remaining}|${clientId}`}
      {/* The two realities the real modal reports: the ERP named the invoice; a PMO Draft has no number yet. */}
      <button onClick={() => onCreated({ id: 'si-erp-returned', si_number: 'ACC-SINV-1' })}>modal-created-numbered</button>
      <button onClick={() => onCreated({ id: 'si-native-returned', si_number: null })}>modal-created-unnamed</button>
    </div>
  ),
}));

import WorkOrdersTab from '../tabs/WorkOrdersTab';
import { financeTestI18n } from '../../__tests__/financeI18nTestInstance';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

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
const renderTab = (role: Role = 'Finance', clientId: string | null = 'c-1', focusWorkOrderId: string | null = null) => {
  h.role = role;
  return render(
    <MemoryRouter><ToastProvider><WorkOrdersTab projectId="p1" currency="USD" clientId={clientId} focusWorkOrderId={focusWorkOrderId} /></ToastProvider></MemoryRouter>,
  );
};

beforeEach(() => {
  h.list = { data: [wo()], isPending: false, isError: false, refetch: vi.fn() };
  h.billing = { data: [bill()], isPending: false, isError: false, refetch: vi.fn() };
  h.invoices = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.boq = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.projectBilling = { data: null, isPending: false, isError: false, refetch: vi.fn() };
  h.orderLines = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.claims = [];
  h.mode = 'erp';
  h.routeReady = true;
});

describe('WorkOrdersTab — billing by work order (OD-BILL-1)', () => {
  it('AC-1402 uses invoice balances for partial payments and never counts an unknown balance as paid or owed', () => {
    h.invoices = {
      data: [
        { id: 'si-part', work_order_id: 'wo-1', status: 'Unpaid', amount: 330_000, erp_outstanding_amount: 250_000, si_number: 'INV-1' },
        { id: 'si-unknown', work_order_id: 'wo-1', status: 'Unpaid', amount: 120_000, erp_outstanding_amount: null, si_number: 'INV-2' },
        { id: 'si-paid', work_order_id: 'wo-1', status: 'Paid', amount: 50_000, erp_outstanding_amount: 0, si_number: 'INV-3' },
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderTab();

    const order = screen.getByTestId('customer-order-wo-1');
    expect(order).toHaveTextContent('Paid $50,000.00');
    expect(order).not.toHaveTextContent('$200,000.00 unpaid');
    expect(screen.getAllByText('Part payments appear once invoice balances arrive from accounting.')).toHaveLength(1);
    expect(order).toHaveTextContent('INV-1');
    expect(order).toHaveTextContent('INV-2');
  });

  it('AC-1402 sums settled amounts when all submitted invoice balances are known', () => {
    h.invoices = {
      data: [{ id: 'si-part', work_order_id: 'wo-1', status: 'Unpaid', amount: 330_000, erp_outstanding_amount: 250_000, si_number: 'INV-1' }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderTab();

    expect(screen.getByTestId('customer-order-wo-1')).toHaveTextContent('Paid $80,000.00');
    expect(screen.getByTestId('customer-order-wo-1')).toHaveTextContent('$250,000.00 unpaid');
    expect(screen.queryByText('Part payments appear once invoice balances arrive from accounting.')).toBeNull();
  });

  it('AC-S15-003 a truly empty work-order register leads with its first-use action, without zero billing totals', () => {
    h.list.data = [];
    renderTab('Admin');

    expect(screen.getByText('No contract lines or customer orders yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New customer order' })).toBeInTheDocument();
    expect(screen.queryByTestId('wo-billing-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-billing-total-still')).not.toBeInTheDocument();
  });

  it('AC-S15-003 loading work orders keep the loading state, never the empty first-use state', () => {
    h.list = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    renderTab();

    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByText('No contract lines or customer orders yet.')).not.toBeInTheDocument();
  });

  it('AC-S15-003 failed work-order reads keep a retry state, never the empty first-use state', () => {
    h.list = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderTab();

    expect(screen.getByText('Couldn’t load the work orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No contract lines or customer orders yet.')).not.toBeInTheDocument();
  });

  it('AC-1402 keeps each order money summary tied to invoice balances', () => {
    h.invoices = { data: [
      { id: 'si-paid', work_order_id: 'wo-1', status: 'Paid', amount: 330_000, erp_outstanding_amount: 0, si_number: 'INV-PAID' },
    ], isPending: false, isError: false, refetch: vi.fn() };
    h.claims = [{ id: 'si-paid', work_order_id: 'wo-1', kind: 'down_payment', withdrawn_at: null,
      down_payment_amount: 330_000, gross_amount: 330_000, invoice: { status: 'Paid', si_number: 'INV-PAID', amount: 330_000 } }];
    renderTab();
    const order = screen.getByTestId('customer-order-wo-1');
    expect(order).toHaveTextContent('Invoiced $330,000.00');
    expect(order).toHaveTextContent('Paid $330,000.00');
    expect(order).toHaveTextContent('incl. down payment');
  });

  it('AC-BWO-004 Finance gets Invoice on an Issued work order with something left; it opens the dialog with what is left', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));
    expect(screen.getByTestId('invoice-modal')).toHaveTextContent('wo-1|80000|c-1');
  });

  it('AC-BWO-004 a Closed work order with something left can still be invoiced (DD-BWO-7)', () => {
    h.list.data = [wo({ status: 'Closed' })];
    h.billing.data = [bill({ status: 'Closed' })];
    renderTab();
    expect(screen.getByRole('button', { name: 'Raise invoice' })).toBeInTheDocument();
  });

  it.each([
    ['a Project Manager', () => {}, 'Project Manager' as Role, 'c-1'],
    ['an Engineer', () => {}, 'Engineer' as Role, 'c-1'],
    ['no project client', () => {}, 'Finance' as Role, null],
    ['nothing left', () => { h.billing.data = [bill({ remaining: 0, pending: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['a Draft work order', () => { h.list.data = [wo({ status: 'Draft' })]; h.billing.data = [bill({ status: 'Draft', invoiced: 0, pending: 0, remaining: 500_000, lineCount: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['figures that cannot be totalled', () => { h.billing.data = [bill({ figuresComplete: false })]; }, 'Finance' as Role, 'c-1'],
  ])('AC-BWO-004 no Invoice for %s', (_label, arrange, role, clientId) => {
    arrange();
    renderTab(role, clientId);
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).toBeNull();
  });

  it('#913 an undecidable revenue mode (undefined — the routing cache is not synced yet) offers no Invoice action', () => {
    h.mode = undefined;
    renderTab();
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).toBeNull();
  });

  it('#913 ownership loaded but repository route not ready offers no Invoice action', () => {
    h.routeReady = false;
    renderTab();
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).toBeNull();
  });

  it('#913 an org where PMO owns revenue gets Invoice too — the same dialog, the same remaining', async () => {
    h.mode = 'native';
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));
    expect(screen.getByTestId('invoice-modal')).toHaveTextContent('wo-1|80000|c-1');
  });

  it('#913 an ERP-owned org reports the created draft by its ERP number', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));
    await userEvent.click(screen.getByRole('button', { name: 'modal-created-numbered' }));
    const toast = await findToastAnnouncement('status', 'Draft invoice created');
    expect(toast).not.toHaveTextContent('submit it from Sales Invoices');
    expect(screen.getByRole('link', { name: 'Open draft' })).toHaveAttribute('href', '/sales-invoices/si-erp-returned');
    expect(screen.getByText('Draft created. A different Finance or Admin user must submit it.')).toBeInTheDocument();
  });

  it('AC-991-003 Indonesian ERP draft handoff names the invoice submission action', async () => {
    await financeTestI18n.changeLanguage('id');
    try {
      h.role = 'Finance';
      render(
        <FinanceI18nTestProvider>
          <MemoryRouter>
            <ToastProvider><WorkOrdersTab projectId="p1" currency="USD" clientId="c-1" /></ToastProvider>
          </MemoryRouter>
        </FinanceI18nTestProvider>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Tagih' }));
      await userEvent.click(screen.getByRole('button', { name: 'modal-created-numbered' }));
      expect(screen.getByText('Draf dibuat. Pengguna Finance atau Admin lain harus mengajukan faktur ini.')).toBeInTheDocument();
    } finally {
      await financeTestI18n.changeLanguage('en');
    }
  });

  it('#913 a PMO-native draft is named by its work order and routed to a second person for approval', async () => {
    h.mode = 'native';
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));
    await userEvent.click(screen.getByRole('button', { name: 'modal-created-unnamed' }));
    const toast = await findToastAnnouncement('status', 'Draft invoice created in PMO');
    expect(toast).not.toHaveTextContent('approves it from Sales Invoices');
    expect(screen.getByRole('link', { name: 'Open draft' })).toHaveAttribute('href', '/sales-invoices/si-native-returned');
    expect(screen.getByText('Draft created. A different Finance or Admin user must approve it.')).toBeInTheDocument();
  });

  it('AC-BWO-004 an Engineer sees no sales-invoice totals or invoice actions', () => {
    renderTab('Engineer');
    const order = screen.getByTestId('customer-order-wo-1');
    expect(order).not.toHaveTextContent('Invoiced');
    expect(order).not.toHaveTextContent('Paid');
    expect(within(order).queryByRole('button', { name: 'Raise invoice' })).toBeNull();
  });

  it('AC-1402 a failed invoice read never renders zero money totals', () => {
    h.invoices = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderTab();
    const order = screen.getByTestId('customer-order-wo-1');
    expect(order).not.toHaveTextContent('Invoiced $0.00');
    expect(order).not.toHaveTextContent('Paid $0.00');
    expect(screen.getByText("Couldn't load invoices")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('WorkOrdersTab — billing actions', () => {







  it('AC-BWO-004 Raise invoice remains reachable in a narrow customer-order block', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 346, height: 0, top: 0, left: 0, right: 346, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    try {
      renderTab();
      expect(screen.getAllByRole('button', { name: 'Raise invoice' })).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('AC-1402 line quantities stay in a scrollable order table and prefill the claim flow', async () => {
    const allocation = { workOrderId: 'wo-1', boqItemId: 'boq-1', quantity: 100, claimedQuantity: 20, acceptedQuantity: 98, final: true };
    h.boq = { data: [{ id: 'boq-1', item_code: 'SURVEY', description: 'Survey route', unit: 'km', quantity: 100, rate: 1_000, earning_basis: 'unit_rate' }], isPending: false, isError: false, refetch: vi.fn() };
    h.orderLines = { data: [{ id: 'line-1', work_order_id: 'wo-1', boq_item_id: 'boq-1', quantity: 100 }], isPending: false, isError: false, refetch: vi.fn() };
    h.projectBilling = { data: {
      currency: 'USD', contractNet: 100_000, workBilled: 0, dpBilled: 0, dpRecovered: 0, notSubmitted: 0,
      assessment: null, claimedByBoqItem: { 'boq-1': 20 }, assessedByBoqItem: {}, earnedValue: 98_000,
      contractLines: [{ boqItemId: 'boq-1', earningBasis: 'unit_rate', lineNo: 1, orderedQuantity: 100,
        acceptedQuantity: 98, closedFinal: 0, earnedQuantity: 98, contractBalance: 0, allocations: [allocation] }],
    }, isPending: false, isError: false, refetch: vi.fn() };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 602, height: 0, top: 0, left: 0, right: 602, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    try {
      renderTab();
      const scroll = screen.getByTestId('wo-lines-table-scroll-wo-1');
      expect(scroll).toHaveClass('overflow-x-auto');
      expect(within(scroll).getByRole('table')).toBeInTheDocument();
      const line = within(scroll).getAllByRole('row')[1];
      expect(line).toHaveTextContent('Survey route');
      expect(line).toHaveTextContent('100');
      expect(line).toHaveTextContent('98');
      expect(line).toHaveTextContent('20');
      expect(line).toHaveTextContent('78');
      await userEvent.click(within(screen.getByTestId('customer-order-wo-1')).getByRole('button', { name: 'Raise invoice' }));
      expect(screen.getByLabelText('Bills')).toHaveValue('wo-1');
      expect(screen.getByLabelText(/SURVEY/)).toHaveValue('78');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('WorkOrdersTab — arriving from a dashboard link to one work order (#786 Discover)', () => {
  it('AC-UNB-005 the linked work order is highlighted, scrolled into view and focused', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    h.list.data = [wo(), wo({ id: 'wo-2', wo_number: 'WO-2', title: 'Phase 2 install' })];
    h.billing.data = [bill(), bill({ workOrderId: 'wo-2' })];
    renderTab('Finance', 'c-1', 'wo-2');
    const target = screen.getByText('WO-2').closest('[data-wo-anchor]') as HTMLElement;
    await vi.waitFor(() => expect(target).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalled();
    expect(target).toHaveTextContent('WO-2');
    expect(screen.getByTestId('customer-order-wo-1')).toBeInTheDocument();
  });

  it('AC-UNB-005 an unknown or absent work order id leaves focus alone', () => {
    renderTab('Finance', 'c-1', 'wo-missing');
    expect(document.activeElement).toBe(document.body);
  });
});
