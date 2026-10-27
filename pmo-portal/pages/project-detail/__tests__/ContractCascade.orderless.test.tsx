import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  boq: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  billing: { data: { contractLines: [], contractNet: 500_000, dpBilled: 0, dpRecovered: 0 } as unknown, isPending: false, isError: false, refetch: vi.fn() },
  orders: { data: [], isPending: false, isError: false, refetch: vi.fn() },
  orderBilling: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  canViewMoney: true,
  drawdown: { data: { committed: 200_000, draft: 50_000, ceiling: 500_000, currency: 'IDR', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => h.boq,
  useProjectBilling: () => h.billing,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.orders, useProjectDrawdown: () => h.drawdown }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.orderBilling }));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => h.invoices }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canViewMoney }));

import { ContractCascade, summarizeInvoiceSettlement } from '../ContractCascade';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

const project = {
  id: 'p1', code: 'PRJ-1', name: 'Busy project', currency: 'IDR', contract_value: 500_000,
  tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 11, tax_base_numerator: 1, tax_base_denominator: 1,
  client: null, end_client: null, pm: null,
} as unknown as ProjectWithRefs;

const RouteSearch = () => {
  const location = useLocation();
  return <output data-testid="cascade-route-search" aria-hidden="true">{location.search}</output>;
};
const renderCascade = (initialEntry = '/') => render(<MemoryRouter initialEntries={[initialEntry]}><FinanceI18nTestProvider><ContractCascade project={project} /><RouteSearch /></FinanceI18nTestProvider></MemoryRouter>);

describe('ContractCascade orderless invoices (AC-1402)', () => {
  beforeEach(() => {
    h.boq = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractLines: [], contractNet: 500_000, dpBilled: 0, dpRecovered: 0 }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.orderBilling = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.invoices = { data: [{ id: 'si-orphan', work_order_id: null, status: 'Unpaid', amount: 12_345.6,
      erp_outstanding_amount: 2_345.6, si_number: 'INV-ORPHAN' }], isPending: false, isError: false, refetch: vi.fn() };
    h.canViewMoney = true;
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
    expect(within(section).getByText('500,000')).toBeInTheDocument();
    expect(within(section).getByText('12,346')).toBeInTheDocument();
    expect(within(section).getByText('10,000')).toBeInTheDocument();
    expect(within(section).getByText('Invoiced')).toBeInTheDocument();
    expect(within(section).getByText('Paid')).toBeInTheDocument();
  });

  it('keeps each contract cascade label and value on separate lines', () => {
    renderCascade();
    const cascade = within(screen.getByRole('list', { name: 'Contract' }));
    const label = cascade.getByText('Contract');
    const value = cascade.getByText('500,000');

    expect(label.parentElement?.parentElement).not.toBe(value.parentElement?.parentElement);
    expect(label.parentElement?.parentElement).toHaveClass('block');
    expect(value.parentElement?.parentElement).toHaveClass('block');
  });

  it('AC-1402 shows can-invoice and overdue callouts from delivered quantities and ERP balances', () => {
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [{ boqItemId: 'b1', contractBalance: 6, allocations: [{ boqItemId: 'b1', workOrderId: 'wo-1', quantity: 4, acceptedQuantity: 4, claimedQuantity: 2 }] }] }, isPending: false, isError: false, refetch: vi.fn() };
    h.invoices = { data: [{ id: 'si-overdue', work_order_id: 'wo-1', status: 'Unpaid', amount: 500, erp_outstanding_amount: 300, erp_due_date: '2020-01-01', si_number: 'INV-OVERDUE' }], isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    expect(screen.getByText('IDR 200')).toBeInTheDocument();
    expect(screen.getByText('IDR 300')).toBeInTheDocument();
    expect(screen.getByText('Can invoice')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
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

  it('AC-1402 does not render contract money for an Engineer', () => {
    h.canViewMoney = false;
    h.boq = { data: [{ id: 'b1', quantity: 10, rate: 100, item_code: 'L-1', description: 'Line', unit: 'ea' }], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractNet: 1_000, dpBilled: 0, dpRecovered: 0, contractLines: [] }, isPending: false, isError: false, refetch: vi.fn() };
    renderCascade();

    expect(screen.queryByRole('heading', { name: 'Contract' })).not.toBeInTheDocument();
    expect(screen.queryByText('1,000')).not.toBeInTheDocument();
    expect(screen.queryByText('Can invoice')).not.toBeInTheDocument();
  });

  it('M4 opens the detailed drawdown disclosure from the cascade headroom line', async () => {
    const user = userEvent.setup();
    renderCascade();
    await user.click(screen.getByRole('button', { name: /Drawdown headroom/ }));
    expect(screen.getByTestId('drawdown-ceiling')).toHaveTextContent('500,000');
    expect(screen.getByTestId('drawdown-committed')).toHaveTextContent('200,000');
    expect(screen.getByTestId('drawdown-draft')).toHaveTextContent('50,000');
  });
});
