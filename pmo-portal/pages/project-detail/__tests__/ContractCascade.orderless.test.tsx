import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  boq: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  billing: { data: { contractLines: [], contractNet: 500_000, dpBilled: 0, dpRecovered: 0 } as unknown, isPending: false, isError: false, refetch: vi.fn() },
  orders: { data: [], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  canViewMoney: true,
}));

vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => h.boq,
  useProjectBilling: () => h.billing,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.orders }));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => h.invoices }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canViewMoney }));

import { ContractCascade } from '../ContractCascade';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

const project = {
  id: 'p1', code: 'PRJ-1', name: 'Busy project', currency: 'IDR', contract_value: 500_000,
  tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 11, tax_base_numerator: 1, tax_base_denominator: 1,
  client: null, end_client: null, pm: null,
} as unknown as ProjectWithRefs;

describe('ContractCascade orderless invoices (AC-1402)', () => {
  beforeEach(() => {
    h.boq = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.billing = { data: { contractLines: [], contractNet: 500_000, dpBilled: 0, dpRecovered: 0 }, isPending: false, isError: false, refetch: vi.fn() };
    h.orders = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.invoices = { data: [{ id: 'si-orphan', work_order_id: null, status: 'Unpaid', amount: 12_345.6,
      erp_outstanding_amount: 2_345.6, si_number: 'INV-ORPHAN' }], isPending: false, isError: false, refetch: vi.fn() };
    h.canViewMoney = true;
  });

  it('shows the contract → invoiced → paid line when invoices exist without contract lines', () => {
    render(<FinanceI18nTestProvider><ContractCascade project={project} /></FinanceI18nTestProvider>);

    const heading = screen.getByRole('heading', { name: 'Contract' });
    const section = heading.closest('section')!;
    expect(section).toHaveTextContent('IDR');
    expect(within(section).getByText('500,000')).toBeInTheDocument();
    expect(within(section).getByText('12,346')).toBeInTheDocument();
    expect(within(section).getByText('10,000')).toBeInTheDocument();
    expect(within(section).getByText('Invoiced', { selector: 'dt' })).toBeInTheDocument();
    expect(within(section).getByText('Paid', { selector: 'dt' })).toBeInTheDocument();
  });
});
