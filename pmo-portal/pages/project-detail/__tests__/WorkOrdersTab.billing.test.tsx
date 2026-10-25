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
  mode: 'erp' as 'erp' | 'native' | undefined,
  routeReady: true,
  role: 'Finance' as string,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => h.list,
  useProjectDrawdown: () => ({ data: { committed: 200_000, draft: 10_000, ceiling: 1_000_000, currency: 'USD', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    setValue: { mutateAsync: vi.fn(), isPending: false }, transition: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectBilling: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptances: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptanceMutations: () => ({}),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.billing }));
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
  h.mode = 'erp';
  h.routeReady = true;
});

describe('WorkOrdersTab — billing by work order (OD-BILL-1)', () => {
  it('AC-PD-WO-01 groups contract headroom and billing before a searchable register sorted by order date', () => {
    h.list.data = [
      wo({ id: 'wo-old', title: 'Older order', order_date: '2026-05-01', created_at: '2026-10-01T00:00:00Z' }),
      wo({ id: 'wo-new', title: 'Newer order', order_date: '2026-09-01', created_at: '2026-01-01T00:00:00Z' }),
    ];
    h.billing.data = [bill({ workOrderId: 'wo-old' }), bill({ workOrderId: 'wo-new' })];
    renderTab();

    const position = screen.getByTestId('project-drawdown');
    expect(position).toContainElement(screen.getByTestId('wo-billing-summary'));
    const toolbar = screen.getByRole('group', { name: 'Work order tools' });
    expect(position.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New work order' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sort work orders')).toHaveValue('newest');

    const newer = screen.getByText('Newer order');
    const older = screen.getByText('Older order');
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-PD-WO-02 search and status filters operate on the register and offer a clear recovery', async () => {
    const user = userEvent.setup();
    h.list.data = [
      wo({ id: 'wo-draft', title: 'Draft for north site', status: 'Draft' }),
      wo({ id: 'wo-issued', title: 'Issued for south site', status: 'Issued' }),
    ];
    h.billing.data = [bill({ workOrderId: 'wo-draft' }), bill({ workOrderId: 'wo-issued' })];
    renderTab();

    await user.selectOptions(screen.getByLabelText('Filter work orders by status'), 'Issued');
    expect(screen.getByText('Issued for south site')).toBeInTheDocument();
    expect(screen.queryByText('Draft for north site')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search work orders'));
    await user.type(screen.getByLabelText('Search work orders'), 'no matching work order');
    expect(screen.getByText('No work orders match these search and filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getByText('Draft for north site')).toBeInTheDocument();
    expect(screen.getByText('Issued for south site')).toBeInTheDocument();
  });

  it('AC-S15-003 a truly empty work-order register leads with its first-use action, without zero billing totals', () => {
    h.list.data = [];
    renderTab('Admin');

    expect(screen.getByText('No work orders on this project yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New work order' })).toBeInTheDocument();
    expect(screen.queryByTestId('wo-billing-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-billing-total-still')).not.toBeInTheDocument();
  });

  it('AC-S15-003 loading work orders keep the loading state, never the empty first-use state', () => {
    h.list = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    renderTab();

    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByText('No work orders on this project yet')).not.toBeInTheDocument();
  });

  it('AC-S15-003 failed work-order reads keep a retry state, never the empty first-use state', () => {
    h.list = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderTab();

    expect(screen.getByText('Couldn’t load the work orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No work orders on this project yet')).not.toBeInTheDocument();
  });

  it("AC-BWO-004 Finance sees the work order's billing status with invoiced, paid and still to invoice, excl. PPN", () => {
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Partly invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Invoiced $330,000.00 · paid $100,000.00');
    expect(cell).toHaveTextContent('Still to invoice $80,000.00');
  });

  it('AC-BWO-004 (SUB-C) "excl. PPN" is said once on the billing summary head — never per row or per total', () => {
    renderTab();
    const basis = screen.getAllByTestId('wo-billing-basis');
    expect(basis).toHaveLength(1);
    expect(basis[0]).toHaveClass('whitespace-nowrap');
    expect(screen.getByTestId('wo-billing-summary').querySelector('h3')).toContainElement(basis[0]);
    expect(within(screen.getByTestId('wo-billing-wo-1')).queryByTestId('wo-billing-basis')).toBeNull();
  });

  it('SUB-C the per-row "Invoiced · paid" line appears only once something has been invoiced', () => {
    h.billing.data = [bill({ invoiced: 0, pending: 0, paid: 0, remaining: 500_000, lineCount: 0, unpaidCount: 0 })];
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(cell).toHaveTextContent('Still to invoice $500,000.00');
    expect(cell).not.toHaveTextContent('Invoiced');
    expect(cell).not.toHaveTextContent('paid');
  });

  it('SUB-C the always-on summary note is gone, but the incomplete-totals note stays', () => {
    const { unmount } = renderTab();
    expect(screen.queryByText(/Issued and closed work orders, less what has been invoiced/)).toBeNull();
    unmount();
    h.billing.data = [bill({ figuresComplete: false, problems: [{ recordId: 'si-9', number: 'ACC-SINV-9', cause: 'no-amount', currency: 'USD' }] })];
    renderTab();
    expect(screen.getByText(/has no amount or is in another currency/)).toBeInTheDocument();
  });

  it('AC-BWO-004 what is still to invoice leads the billing cell, ahead of invoiced and paid', () => {
    renderTab();
    const text = screen.getByTestId('wo-billing-wo-1').textContent ?? '';
    expect(text.indexOf('Still to invoice')).toBeGreaterThan(-1);
    expect(text.indexOf('Still to invoice')).toBeLessThan(text.indexOf('Invoiced'));
  });

  it('AC-BWO-004 the billing state reads as its own chip, never the same mark as the work order status beside it', () => {
    renderTab();
    const billingPill = within(screen.getByTestId('wo-billing-wo-1')).getByText('Partly invoiced');
    const statusPill = within(screen.getAllByRole('row')[1]).getAllByText('Issued')[0];
    expect(billingPill).toHaveClass('bg-secondary');
    expect(statusPill).not.toHaveClass('bg-secondary');
  });

  it('AC-BWO-004 an incl.-PPN work order shows the net value its billing figures reconcile against', () => {
    h.list.data = [wo({ order_value: 555_000, tax_treatment: 'inclusive', tax_amount: 55_000 })];
    h.billing.data = [bill({ orderNet: 500_000 })];
    renderTab();
    expect(screen.getByTestId('wo-billing-wo-1')).toHaveTextContent('Net value $500,000.00');
  });

  it('AC-BWO-004 an excl.-PPN work order needs no net line — its order value already is the net', () => {
    renderTab();
    expect(screen.getByTestId('wo-billing-wo-1')).not.toHaveTextContent('Net value');
  });

  it("AC-BWO-004 a work order that can't be totalled names the invoice and the cause", () => {
    h.billing.data = [bill({
      figuresComplete: false,
      problems: [
        { recordId: 'si-9', number: 'ACC-SINV-9', cause: 'no-amount', currency: 'USD' },
        { recordId: 'si-7', number: 'ACC-SINV-7', cause: 'other-currency', currency: 'EUR' },
        { recordId: 'pc-1', number: null, cause: 'no-amount', currency: 'USD' },
      ],
    })];
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText("Can't total")).toBeInTheDocument();
    expect(cell).toHaveTextContent('ACC-SINV-9 has no amount');
    expect(cell).toHaveTextContent('ACC-SINV-7 is in EUR');
    expect(cell).toHaveTextContent('An invoice has no amount');
  });

  it.each([
    ['Paid', bill({ invoiced: 500_000, pending: 0, paid: 500_000, remaining: 0, unpaidCount: 0 }), 'Paid'],
    ['Fully invoiced', bill({ invoiced: 500_000, pending: 0, remaining: 0, unpaidCount: 2 }), 'Fully invoiced'],
    ['Awaiting submission', bill({ invoiced: 0, pending: 500_000, paid: 0, remaining: 0, unpaidCount: 0 }), 'Awaiting submission'],
    ['Not invoiced', bill({ invoiced: 0, pending: 0, paid: 0, remaining: 500_000, lineCount: 0, unpaidCount: 0 }), 'Not invoiced'],
    ["Can't total", bill({ figuresComplete: false }), "Can't total"],
  ])('AC-BWO-004 shows %s', (_label, row, pill) => {
    h.billing.data = [row];
    renderTab();
    expect(within(screen.getByTestId('wo-billing-wo-1')).getByText(pill)).toBeInTheDocument();
  });

  it("AC-BWO-003 a work order covered only by a draft reads Awaiting submission with the draft amount — never 'Fully invoiced'", () => {
    h.billing.data = [bill({ invoiced: 0, pending: 500_000, paid: 0, remaining: 0, unpaidCount: 0 })];
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Awaiting submission')).toBeInTheDocument();
    expect(within(cell).queryByText('Fully invoiced')).toBeNull();
    expect(cell).toHaveTextContent('Not yet submitted $500,000.00');
    expect(screen.getByTestId('wo-billing-total-draft')).toHaveTextContent('Not yet submitted$500,000.00');
  });

  it('AC-BWO-003 the awaiting-submission pill reads in Bahasa', async () => {
    h.billing.data = [bill({ invoiced: 0, pending: 500_000, paid: 0, remaining: 0, unpaidCount: 0 })];
    await financeTestI18n.changeLanguage('id');
    try {
      h.role = 'Finance';
      render(<FinanceI18nTestProvider><ToastProvider><WorkOrdersTab projectId="p1" currency="USD" clientId="c-1" /></ToastProvider></FinanceI18nTestProvider>);
      expect(within(screen.getByTestId('wo-billing-wo-1')).getByText('Menunggu dikirim')).toBeInTheDocument();
    } finally {
      await financeTestI18n.changeLanguage('en');
    }
  });

  it('AC-BWO-003 the summary leads with what is still to invoice', () => {
    renderTab();
    const labels = within(screen.getByTestId('wo-billing-summary')).getAllByRole('term').map((dt) => dt.textContent);
    expect(labels[0]).toBe('Still to invoice');
  });

  it('AC-BWO-003 with nothing in draft, no draft line or total is shown', () => {
    h.billing.data = [bill({ pending: 0, remaining: 170_000 })];
    renderTab();
    expect(screen.getByTestId('wo-billing-wo-1')).not.toHaveTextContent('Not yet submitted');
    expect(screen.queryByTestId('wo-billing-total-draft')).toBeNull();
  });

  it('AC-BWO-004 an over-invoiced work order states the excess', () => {
    h.billing.data = [bill({ remaining: -1_000 })];
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Over-invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Over by $1,000.00');
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
    ['an Engineer', () => {}, 'Engineer' as Role, 'c-1'],
    ['no project client', () => {}, 'Finance' as Role, null],
    ['nothing left', () => { h.billing.data = [bill({ remaining: 0, pending: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['a Draft work order', () => { h.list.data = [wo({ status: 'Draft' })]; h.billing.data = [bill({ status: 'Draft', invoiced: 0, pending: 0, remaining: 500_000, lineCount: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['figures that cannot be totalled', () => { h.billing.data = [bill({ figuresComplete: false })]; }, 'Finance' as Role, 'c-1'],
  ])('AC-BWO-004 no Invoice for %s', (_label, arrange, role, clientId) => {
    arrange();
    renderTab(role, clientId);
    expect(screen.queryByRole('button', { name: 'Invoice' })).toBeNull();
  });

  it('#913 an undecidable revenue mode (undefined — the routing cache is not synced yet) offers no Invoice action', () => {
    h.mode = undefined;
    renderTab();
    expect(screen.queryByRole('button', { name: 'Invoice' })).toBeNull();
  });

  it('#913 ownership loaded but repository route not ready offers no Invoice action', () => {
    h.routeReady = false;
    renderTab();
    expect(screen.queryByRole('button', { name: 'Invoice' })).toBeNull();
  });

  it('#913 an org where PMO owns revenue gets Invoice too — the same dialog, the same remaining', async () => {
    h.mode = 'native';
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Invoice' }));
    expect(screen.getByTestId('invoice-modal')).toHaveTextContent('wo-1|80000|c-1');
  });

  it('#913 an ERP-owned org reports the created draft by its ERP number', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Invoice' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Invoice' }));
    await userEvent.click(screen.getByRole('button', { name: 'modal-created-unnamed' }));
    const toast = await findToastAnnouncement('status', 'Draft invoice created in PMO');
    expect(toast).not.toHaveTextContent('approves it from Sales Invoices');
    expect(screen.getByRole('link', { name: 'Open draft' })).toHaveAttribute('href', '/sales-invoices/si-native-returned');
    expect(screen.getByText('Draft created. A different Finance or Admin user must approve it.')).toBeInTheDocument();
  });

  it('AC-UNB-002 the project totals add Issued and Closed work orders; an over-invoiced one adds nothing left', () => {
    h.list.data = [wo(), wo({ id: 'wo-2', status: 'Closed', wo_number: 'WO-2' }), wo({ id: 'wo-3', status: 'Draft', wo_number: null })];
    h.billing.data = [
      bill(),
      bill({ workOrderId: 'wo-2', status: 'Closed', invoiced: 105_000, pending: 0, paid: 0, remaining: -5_000 }),
      bill({ workOrderId: 'wo-3', status: 'Draft', invoiced: 0, pending: 0, paid: 0, remaining: 900_000, lineCount: 0, unpaidCount: 0 }),
    ];
    renderTab();
    expect(screen.getByTestId('wo-billing-total-invoiced')).toHaveTextContent('$435,000.00');
    expect(screen.getByTestId('wo-billing-total-paid')).toHaveTextContent('$100,000.00');
    expect(screen.getByTestId('wo-billing-total-still')).toHaveTextContent('$80,000.00');
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

describe('WorkOrdersTab — billing actions', () => {







  it('AC-BWO-004 the Invoice action remains reachable in a narrow work-order container', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 346, height: 0, top: 0, left: 0, right: 346, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    try {
      renderTab();
      expect(screen.getAllByRole('button', { name: 'Invoice' })).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('AC-BWO-004 where the columns fit (1280px), it stays a table', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 602, height: 0, top: 0, left: 0, right: 602, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    try {
      renderTab();
      expect(screen.getByRole('table')).toBeInTheDocument();
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
    expect(target.closest('tr')).toHaveClass('bg-primary/[0.07]');
    expect(screen.getByText('WO-1').closest('tr')).not.toHaveClass('bg-primary/[0.07]');
  });

  it('AC-UNB-005 an unknown or absent work order id leaves focus alone', () => {
    renderTab('Finance', 'c-1', 'wo-missing');
    expect(document.activeElement).toBe(document.body);
  });
});
