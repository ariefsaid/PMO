import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  boq: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  billing: { data: { contractLines: [], contractNet: 500_000, dpBilled: 0, dpRecovered: 0 } as unknown, isPending: false, isError: false, refetch: vi.fn() },
  orders: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  orderBilling: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  childLines: vi.fn(() => ({ data: [], isPending: false, isError: false })),
  canViewMoney: true,
  orgDay: '2026-06-01' as string | null,
  drawdown: { data: { committed: 200_000, draft: 50_000, ceiling: 500_000, currency: 'IDR', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => h.boq,
  useProjectBilling: () => h.billing,
  useProjectClaims: () => ({ data: [] }),
  useProgressBillingMutations: () => ({}),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.orders, useProjectDrawdown: () => h.drawdown, useWorkOrderMutations: () => ({}) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.orderBilling, useWorkOrderAcceptanceAge: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => h.invoices }));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: { contract_invoiced: '12345.60', remaining_to_invoice: '487654.40' }, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canViewMoney }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({ useProjectWorkOrderLines: h.childLines, useWorkOrderAcceptances: () => ({ data: [] }), useWorkOrderAcceptanceMutations: () => ({}) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: () => true, useOwnershipCacheSynced: () => true }));
// #1457: the overdue figure is bounded by the org's business day; the cascade's overdue rule reads it.
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: h.orgDay, isPending: false, isError: false, retry: vi.fn() }),
}));

import { ContractCascade, summarizeInvoiceSettlement } from '../ContractCascade';
import WorkOrdersTab from '../tabs/WorkOrdersTab';
import { ToastProvider } from '@/src/components/ui';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

const project = {
  id: 'p1', code: 'PRJ-1', name: 'Busy project', currency: 'IDR', contract_value: 500_000,
  tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 11, tax_base_numerator: 1, tax_base_denominator: 1,
  client: null, end_client: null, pm: null, project_manager_id: 'pm-synthetic',
} as unknown as ProjectWithRefs;

const RouteSearch = () => {
  const location = useLocation();
  return <output data-testid="cascade-route-search" aria-hidden="true">{location.search}</output>;
};
const renderCascade = (initialEntry = '/', children?: React.ReactNode) => render(<MemoryRouter initialEntries={[initialEntry]}><FinanceI18nTestProvider><ContractCascade project={project}>{children}</ContractCascade><RouteSearch /></FinanceI18nTestProvider></MemoryRouter>);

describe('ContractCascade orderless invoices (AC-1402)', () => {
  beforeEach(() => {
    h.boq = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractLines: [], contractNet: 500_000, dpBilled: 0, dpRecovered: 0 }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.orderBilling = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.invoices = { data: [{ id: 'si-orphan', work_order_id: null, status: 'Unpaid', amount: 12_345.6,
      erp_outstanding_amount: 2_345.6, si_number: 'INV-ORPHAN' }], isPending: false, isError: false, refetch: vi.fn() };
    h.canViewMoney = true;
    h.orgDay = '2026-06-01';
    h.drawdown = { data: { committed: 200_000, draft: 50_000, ceiling: 500_000, currency: 'IDR', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() };
  });

  // Payments can land outside the ERP balance (project receipts), so a missing balance is unknown, never "all unpaid".
  it('AC-1402 leaves paid/unpaid unknown when a submitted invoice has no accounting balance', () => {
    expect(summarizeInvoiceSettlement([{ status: 'Submitted', amount: 7_700_000, erp_outstanding_amount: null }])).toEqual({
      invoiced: 7_700_000,
      paid: 0,
      unpaid: null,
      balancesKnown: false,
    });
  });

  it('shows the contract → invoiced → paid line when invoices exist without contract lines', () => {
    renderCascade();

    const heading = screen.getByRole('heading', { name: 'Contract' });
    const section = heading.closest('section')!;
    expect(section).toHaveTextContent('IDR');
    // Each tile figure names its currency; the compact form carries the exact amount as its title.
    expect(within(section).getByText('IDR 500K')).toBeInTheDocument();
    expect(within(section).getByText('IDR 12.3K')).toBeInTheDocument();
    expect(within(section).getByText('IDR 10K')).toBeInTheDocument();
    expect(within(section).getByText('Invoiced')).toBeInTheDocument();
    expect(within(section).getByText('Paid')).toBeInTheDocument();
  });

  it('screen rules: leaves the project tax basis to the customer-orders heading', () => {
    renderCascade();

    const contract = screen.getByRole('region', { name: 'Contract' });
    expect(within(contract).getByText('IDR')).toBeInTheDocument();
    expect(within(contract).queryByText(/excl\. PPN/)).not.toBeInTheDocument();
  });

  it('keeps contract tools with the contract summary', () => {
    const props = { project, contractTools: <button>Edit contract lines</button> };
    render(<MemoryRouter><FinanceI18nTestProvider><ContractCascade {...props} /></FinanceI18nTestProvider></MemoryRouter>);
    expect(within(screen.getByRole('region', { name: 'Contract' })).getByRole('button', { name: 'Edit contract lines' })).toBeInTheDocument();
  });

  it('C1 keeps independent contract tools reachable when a cascade read fails and retries the failed reads', async () => {
    const user = userEvent.setup();
    const refetchBoq = vi.fn();
    const refetchBilling = vi.fn();
    const refetchOrders = vi.fn();
    h.boq = { data: undefined, isPending: false, isError: true, refetch: refetchBoq };
    h.billing = { data: undefined, isPending: false, isError: false, refetch: refetchBilling };
    h.orders = { data: [], isPending: false, isError: false, refetch: refetchOrders };

    render(<MemoryRouter><FinanceI18nTestProvider><ContractCascade project={project} contractTools={<button type="button">Open customer orders</button>} /></FinanceI18nTestProvider></MemoryRouter>);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText("Couldn't load the contract")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open customer orders' })).toBeVisible();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(refetchBoq).toHaveBeenCalledTimes(1);
    expect(refetchBilling).toHaveBeenCalledTimes(1);
    expect(refetchOrders).toHaveBeenCalledTimes(1);
  });

  it('labels contract value and omits its self-comparison bar', () => {
    renderCascade();
    const cascade = within(screen.getByRole('list', { name: 'Contract' }));
    const figure = cascade.getByRole('listitem', { name: /Contract value IDR\s500K/ });

    expect(within(figure).getByText('Contract value')).toBeVisible();
    expect(within(figure).getByText('IDR 500K')).toBeVisible();
    expect(within(figure).queryByRole('progressbar', { name: 'Contract' })).not.toBeInTheDocument();
  });

  it('explains contract percentages once at the section heading', async () => {
    const user = userEvent.setup();
    renderCascade();

    // The explanation lives behind the card head's one help control: the heading itself stays plain
    // text (CardHead's children may hold no interactive content — the static guard enforces it), and
    // the note is said once, not repeated under each figure.
    const headingRow = screen.getByRole('heading', { name: 'Contract' }).parentElement!.parentElement!;
    await user.click(within(headingRow).getByRole('button', { name: 'About Contract' }));

    expect(await screen.findByText('Computed as this stage value divided by the contract value.')).toBeVisible();
  });

  it('AC-1402 shows can-invoice and overdue callouts from delivered quantities and ERP balances', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: 4, claimedQuantity: 2 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.invoices = { data: [{ id: 'si-overdue', work_order_id: 'wo-1', status: 'Unpaid', amount: 500, erp_outstanding_amount: 300, erp_due_date: '2020-01-01', si_number: 'INV-OVERDUE' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const section = screen.getByRole('heading', { name: 'Contract' }).closest('section')!;
    // A figure names its currency wherever it stands.
    expect(within(section).getByText('Can invoice').parentElement).toHaveTextContent(/^Can invoiceIDR 200$/);
    expect(within(section).getByText('IDR 300').parentElement).toHaveTextContent(/^OverdueIDR 300$/);
    expect(within(section).getByText('Can invoice')).toBeInTheDocument();
    expect(within(section).getByText('Overdue')).toBeInTheDocument();
  });

  it('explains a zero billable amount when no customer order is recorded', () => {
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    expect(checklist).not.toHaveTextContent('Phase progress is not billable quantity.');
    expect(checklist).not.toHaveTextContent('No customer orders.');
    const orderStep = within(checklist).getByTestId('billability-step-order');
    expect(orderStep).toHaveAccessibleName('Order');
    expect(within(orderStep).getByText('Missing')).toBeVisible();
    expect(within(orderStep).queryByRole('link', { name: 'Add customer order' })).not.toBeInTheDocument();
    const allocationStep = within(checklist).getByTestId('billability-step-allocation');
    expect(allocationStep).toHaveAccessibleName('Lines');
    expect(within(allocationStep).getByText('None')).toBeVisible();
    const acceptanceStep = within(checklist).getByTestId('billability-step-acceptance');
    expect(acceptanceStep).toHaveAccessibleName('Accepted');
    expect(within(acceptanceStep).getByText('None')).toBeVisible();
    const unclaimedStep = within(checklist).getByTestId('billability-step-unclaimed');
    expect(unclaimedStep).toHaveAccessibleName('Unclaimed');
    expect(within(unclaimedStep).getByText('Missing')).toBeVisible();
    const headingRow = screen.getByRole('heading', { name: 'Billing' }).parentElement!;
    expect(within(headingRow).getByRole('link', { name: 'Add customer order' })).toHaveAttribute('href', '/projects/p1/contract#add-customer-order');
  });

  it('names a draft customer order as the blocker and links to that order', () => {
    h.orders = { data: [{ id: 'wo-draft', status: 'Draft' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    expect(checklist).toHaveTextContent('The customer order is still a draft.');
    expect(within(checklist).getByRole('link', { name: 'Open draft order' })).toHaveAttribute('href', '/projects/p1/contract?wo=wo-draft');
  });

  it('explains a zero billable amount when customer orders have no allocated contract lines', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 10, allocations: [] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [{ id: 'wo-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    expect(checklist).toHaveTextContent('No contract lines are allocated.');
    expect(within(within(checklist).getByTestId('billability-step-order')).getByText('Done')).toBeVisible();
    expect(within(within(checklist).getByTestId('billability-step-allocation')).getByText('Missing')).toBeVisible();
    expect(within(checklist).getByRole('link', { name: 'Allocate contract lines' })).toHaveAttribute('href', '/projects/p1/contract?wo=wo-1');
  });

  it('explains a zero billable amount when allocated lines have no accepted quantities', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: null, claimedQuantity: 0 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [{ id: 'wo-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    expect(checklist).toHaveTextContent('No accepted quantities.');
    expect(within(within(checklist).getByTestId('billability-step-acceptance')).getByText('Missing')).toBeVisible();
    expect(within(checklist).getByRole('link', { name: 'Record accepted quantity' })).toHaveAttribute('href', '/projects/p1/contract?wo=wo-1');
  });

  it('explains that accepted quantities are already claimed when nothing remains to bill', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: 4, claimedQuantity: 4 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [{ id: 'wo-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    expect(checklist).toHaveTextContent('Accepted quantities are already claimed.');
    expect(within(within(checklist).getByTestId('billability-step-unclaimed')).getByText('Missing')).toBeVisible();
  });

  it('explains when money-only customer order value is already invoiced', () => {
    h.orders = { data: [{ id: 'wo-money', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() };
    h.orderBilling = { data: [{ lineCount: 0, figuresComplete: true, remaining: 0 }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    expect(checklist).toHaveTextContent('Customer order value is already invoiced.');
    expect(within(within(checklist).getByTestId('billability-step-order')).getByText('Done')).toBeVisible();
  });

  it('shows a real computed zero separately from missing or claimed billing inputs', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 0, item_code: 'L-1', description: 'Zero-rate line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 0, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: 4, claimedQuantity: 0 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [{ id: 'wo-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    expect(checklist).toHaveTextContent('The billable total is zero at current contract rates.');
    expect(within(within(checklist).getByTestId('billability-step-unclaimed')).getByText('Done')).toBeVisible();
    expect(within(checklist).queryByText('No accepted quantities.')).not.toBeInTheDocument();
    expect(within(checklist).queryByText('Accepted quantities are already claimed.')).not.toBeInTheDocument();
  });

  it('marks every billability check done when accepted unclaimed quantity has value', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: 4, claimedQuantity: 2 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [{ id: 'wo-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const checklist = screen.getByRole('region', { name: 'Billing' });
    const summary = screen.getByRole('heading', { name: 'Contract' }).closest('section')!;
    expect(within(summary).getByText('Can invoice').parentElement).toHaveTextContent(/^Can invoiceIDR 200$/);
    for (const step of ['order', 'allocation', 'acceptance', 'unclaimed']) {
      expect(within(within(checklist).getByTestId(`billability-step-${step}`)).getByText('Done')).toBeVisible();
    }
    expect(within(checklist).queryByText(/zero at current contract rates/i)).not.toBeInTheDocument();
  });

  // #1457 regression: the shared overdue rule derives the due date when the ERP one is absent, so a
  // terms-past-due invoice that the old ERP-due-date-only copy missed now counts, on the org day.
  it('#1457 counts an invoice past its terms-derived due date even without an ERP due date', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [] }] }, isPending: false, isError: false, refetch: vi.fn() };
    // invoice_date 2026-01-05 + 30 terms = due 2026-02-04; org day 2026-06-01 → 117 days overdue.
    h.invoices = { data: [{ id: 'si-terms-overdue', work_order_id: null, status: 'Unpaid', amount: 800, erp_outstanding_amount: 450, erp_due_date: null, invoice_date: '2026-01-05', erp_payment_terms_days: 30, si_number: 'INV-TERMS' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const section = screen.getByRole('heading', { name: 'Contract' }).closest('section')!;
    expect(within(section).getByText('IDR 450').parentElement).toHaveTextContent(/^OverdueIDR 450$/);
  });

  it('#1457 leaves an invoice out of the overdue figure until the organization day is known', () => {
    h.orgDay = null;
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.invoices = { data: [{ id: 'si-overdue', work_order_id: null, status: 'Unpaid', amount: 500, erp_outstanding_amount: 300, erp_due_date: '2020-01-01', si_number: 'INV-OVERDUE' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    const section = screen.getByRole('heading', { name: 'Contract' }).closest('section')!;
    expect(within(section).queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('AC-1402 opens the not-yet-ordered contract line in an addressable quantity-history drawer', async () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: 4, claimedQuantity: 2 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    const user = userEvent.setup();
    renderCascade();

    await user.click(screen.getByRole('button', { name: 'Open Line quantity history' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Quantity history')).toBeInTheDocument();
    expect(screen.getByTestId('cascade-route-search')).toHaveTextContent('open=b1&openType=contractBoq');
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toBeInTheDocument();
  });

  it('AC-CQ-020 exposes the remaining contract quantity on its visible not-yet-ordered row', () => {
    h.boq = { data: [{ id: 'b1', quantity: 1_900, rate: 50_000, item_code: 'KM-1', description: 'Cable route', unit: 'km' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 95_000_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 903, allocations: [] }] }, isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    expect(screen.getByTestId('contract-balance-b1')).toHaveTextContent(/903\s*km/);
  });

  it('AC-1402 does not render contract money for an Engineer', () => {
    h.canViewMoney = false;
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [] }, isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    expect(screen.queryByRole('heading', { name: 'Contract' })).not.toBeInTheDocument();
    expect(screen.queryByText('1,000')).not.toBeInTheDocument();
    expect(screen.queryByText('Can invoice')).not.toBeInTheDocument();
  });

  it('M4 shows the detailed drawdown figures directly beside the contract cascade', () => {
    renderCascade();

    const drawdown = screen.getByTestId('project-drawdown');
    expect(drawdown).toBeVisible();
    expect(within(drawdown).getByTestId('drawdown-ceiling')).toHaveTextContent('500,000');
    expect(within(drawdown).getByTestId('drawdown-committed')).toHaveTextContent('200,000');
    expect(within(drawdown).getByTestId('drawdown-draft')).toHaveTextContent('50,000');
    expect(screen.queryByRole('button', { name: 'Drawdown headroom' })).not.toBeInTheDocument();
  });

  it('L6: the not-yet-ordered value is shown once without a retired drawdown toggle', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: 4, claimedQuantity: 2 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.orderBilling = { data: [{ status: 'Issued', orderNet: 400, lineCount: 1, figuresComplete: true, remaining: 0 }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();
    const section = screen.getByRole('heading', { name: 'Contract' }).closest('section')!;
    expect(within(section).getAllByText('IDR 600')).toHaveLength(1);
    expect(within(section).queryByRole('button', { name: 'Drawdown headroom' })).not.toBeInTheDocument();
  });

  it('keeps the completed parent error boundary around children', () => {
    h.boq = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderCascade('/', <div data-testid="child-content">Customer orders</div>);
    expect(screen.getByText("Couldn't load the contract")).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('prioritizes loading over an error while another parent query is pending', () => {
    h.boq = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    h.billing = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    renderCascade('/', <div data-testid="child-content">Customer orders</div>);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the contract")).not.toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('starts the real customer orders child query while cascade metrics are pending', () => {
    h.boq = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    h.billing = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    h.orders = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    h.childLines.mockClear();
    renderCascade('/', <ToastProvider><WorkOrdersTab projectId={project.id} currency={project.currency} /></ToastProvider>);
    expect(h.childLines).toHaveBeenCalledWith(project.id);
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  });

  it('mounts children concurrently while cascade queries are pending', () => {
    h.boq = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    h.billing = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    h.orders = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };

    const childMounted = vi.fn();
    const ChildComponent = () => {
      React.useEffect(() => { childMounted(); }, []);
      return <div data-testid="concurrent-child">Customer orders content</div>;
    };

    renderCascade('/', <ChildComponent />);

    expect(screen.getByTestId('concurrent-child')).toBeInTheDocument();
    expect(childMounted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });
});
