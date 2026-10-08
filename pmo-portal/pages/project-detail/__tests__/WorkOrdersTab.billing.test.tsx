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
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.billing }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.mode }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: (mode: unknown) => h.routeReady && mode !== undefined }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: h.role }) }));
vi.mock('../InvoiceWorkOrderModal', () => ({
  default: ({ workOrder, remaining, clientId, onCreated }: { workOrder: { id: string }; remaining: number; clientId: string; onCreated: (n: string) => void }) => (
    <div data-testid="invoice-modal">
      {`${workOrder.id}|${remaining}|${clientId}`}
      {/* The two realities the real modal reports: the ERP named the invoice; a PMO Draft has no number yet. */}
      <button onClick={() => onCreated('ACC-SINV-1')}>modal-created-numbered</button>
      <button onClick={() => onCreated('')}>modal-created-unnamed</button>
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
    <ToastProvider><WorkOrdersTab projectId="p1" currency="USD" clientId={clientId} focusWorkOrderId={focusWorkOrderId} /></ToastProvider>,
  );
};

beforeEach(() => {
  h.list.data = [wo()];
  h.billing = { data: [bill()], isPending: false, isError: false, refetch: vi.fn() };
  h.mode = 'erp';
  h.routeReady = true;
});

describe('WorkOrdersTab — billing by work order (OD-BILL-1)', () => {
  it("AC-BWO-004 Finance sees the work order's billing status with invoiced, paid and still to invoice, excl. PPN", () => {
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Partly invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Invoiced $330,000.00 · paid $100,000.00');
    expect(cell).toHaveTextContent('Still to invoice $80,000.00');
    expect(within(cell).getByTestId('wo-billing-basis')).toHaveTextContent('excl. PPN');
  });

  it('AC-BWO-004 one "excl. PPN" qualifies the whole billing cell — not one per figure — and it never wraps', () => {
    renderTab();
    const basis = within(screen.getByTestId('wo-billing-wo-1')).getAllByTestId('wo-billing-basis');
    expect(basis).toHaveLength(1);
    expect(basis[0]).toHaveClass('whitespace-nowrap');
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
    expect(screen.getByTestId('wo-billing-total-draft')).toHaveTextContent('Not yet submitted$500,000.00excl. PPN');
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
    expect(screen.getByRole('status')).toHaveTextContent('Draft invoice created');
    expect(screen.getByRole('status')).toHaveTextContent('ACC-SINV-1 — submit it from Sales Invoices.');
  });

  it('#913 a PMO-native draft is named by its work order and routed to a second person for approval', async () => {
    h.mode = 'native';
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Invoice' }));
    await userEvent.click(screen.getByRole('button', { name: 'modal-created-unnamed' }));
    expect(screen.getByRole('status')).toHaveTextContent('Draft invoice created in PMO');
    expect(screen.getByRole('status')).toHaveTextContent('WO-1 — a second Finance/Admin person approves it from Sales Invoices.');
    expect(screen.getByRole('status')).not.toHaveTextContent('ERPNext');
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

  it('AC-BWO-004 in a column too narrow for its columns (1024px beside the record panel) the work orders become record cards — Invoice reachable, no sideways scroll', () => {
    // The geometry itself is proven in the browser (e2e AC-BWO-004 work-order billing geometry); here, the switch.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 346, height: 0, top: 0, left: 0, right: 346, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    try {
      renderTab();
      expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Invoice' })).toHaveLength(1);
      // The card lists Status as a field: the copy folded under the WO number stays hidden there.
      const folded = within(screen.getByTestId('dt-card-branch')).getAllByText('Issued')
        .map((el) => el.closest('.\\@2xl\\:hidden'))
        .find(Boolean);
      expect(folded).toHaveClass('[[data-dt-cards]_&]:hidden');
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
