import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import { formatCurrencyAuto, formatDateOnly } from '@/src/lib/format';

type Q = { data: unknown[] | undefined; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> };
const q = (data: unknown[] | undefined = []): Q => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const h = vi.hoisted(() => ({
  list: {} as Q, billing: {} as Q, age: {} as Q, role: 'Finance' as string,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.list }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useWorkOrderBilling: () => h.billing,
  useWorkOrderAcceptanceAge: () => h.age,
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: h.role }) }));

import { BillingMilestonesBlock } from '../BillingMilestonesBlock';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

const wo = (over: Partial<WorkOrderRow> = {}): WorkOrderRow => ({
  id: 'wo-1', org_id: 'org-1', project_id: 'p1', wo_number: 'WO-1', client_po_number: null, title: 'Phase 1 fabrication',
  description: null, status: 'Issued', order_value: 1000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0,
  tax_rate: null, tax_template: null, tax_base_numerator: 1, tax_base_denominator: 1, order_date: null,
  start_date: null, end_date: null, order_value_set_by: null, order_value_set_at: null,
  issued_by: null, issued_at: null, over_commit_ack_by: null, over_commit_ack_at: null,
  closed_at: null, cancelled_at: null, created_at: '2026-08-01T00:00:00Z', ...over,
}) as WorkOrderRow;
const bill = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 1000, invoiced: 0, pending: 0,
  paid: 0, remaining: 1000, figuresComplete: true, lineCount: 0, unpaidCount: 0, ...over,
});
const renderBlock = (role = 'Finance') => {
  h.role = role;
  return render(
    <MemoryRouter><FinanceI18nTestProvider><BillingMilestonesBlock projectId="p1" /></FinanceI18nTestProvider></MemoryRouter>,
  );
};

beforeEach(() => {
  h.list = q([wo()]);
  h.billing = q([bill()]);
  h.age = q([]);
});

describe('BillingMilestonesBlock (#1640)', () => {
  it('AC-WOMS-001 lists each non-cancelled work order once, by id, and never the cancelled one', () => {
    h.list = q([
      wo(),
      wo({ id: 'wo-2', wo_number: null, status: 'Draft', title: 'Phase 2' }),
      wo({ id: 'wo-3', wo_number: 'WO-3', status: 'Cancelled', title: 'Dropped' }),
    ]);
    h.billing = q([bill(), bill({ workOrderId: 'wo-2', status: 'Draft' }), bill({ workOrderId: 'wo-3', status: 'Cancelled' })]);
    renderBlock();
    expect(screen.getByTestId('billing-milestone-wo-1')).toBeInTheDocument();
    const draft = screen.getByTestId('billing-milestone-wo-2');
    expect(screen.queryByTestId('billing-milestone-wo-3')).toBeNull();
    expect(within(draft).getByText('Not issued yet')).toBeInTheDocument();
    expect(within(draft).getByText('Planned')).toBeInTheDocument();
  });

  it('AC-WOMS-001 a role without billing visibility sees no block', () => {
    const { container } = renderBlock('Engineer');
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-WOMS-002 rows follow the milestone date and show dates, value excl. tax and status', () => {
    h.list = q([
      wo({ id: 'a', wo_number: 'WO-4', title: 'Undated' }),
      wo({ id: 'b', wo_number: 'WO-3', title: 'Both', start_date: '2026-11-10', end_date: '2026-12-01', order_value: 2500 }),
      wo({ id: 'c', wo_number: 'WO-2', title: 'Ordered only', order_date: '2026-10-01' }),
      wo({ id: 'd', wo_number: 'WO-1', title: 'Start only', start_date: '2026-11-10' }),
    ]);
    h.billing = q(['a', 'b', 'c', 'd'].map((id) => bill({ workOrderId: id, orderNet: id === 'b' ? 2500 : 1000 })));
    renderBlock();
    const ids = screen.getAllByTestId(/^billing-milestone-/).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['billing-milestone-c', 'billing-milestone-d', 'billing-milestone-b', 'billing-milestone-a']);
    expect(screen.getByText(`Ordered ${formatDateOnly('2026-10-01')}`)).toBeInTheDocument();
    expect(screen.getByText(`From ${formatDateOnly('2026-11-10')}`)).toBeInTheDocument();
    expect(screen.getByText(`${formatDateOnly('2026-11-10')} – ${formatDateOnly('2026-12-01')}`)).toBeInTheDocument();
    expect(screen.getByText('No dates')).toBeInTheDocument();
    const both = screen.getByTestId('billing-milestone-b');
    expect(both.textContent).toContain(formatCurrencyAuto(2500, 'USD'));
    for (const id of ids) expect(within(screen.getByTestId(id!)).getByTestId('tax-basis')).toHaveTextContent(/excl/i);
  });

  it('AC-WOMS-003 shows the derived status, Over-invoiced as a flag, and Can\'t total when the figures are incomplete', () => {
    h.list = q([wo({ id: 'a' }), wo({ id: 'b', wo_number: 'WO-2' }), wo({ id: 'c', wo_number: 'WO-3' })]);
    h.billing = q([
      bill({ workOrderId: 'a', invoiced: 1000, paid: 1000, remaining: 0 }),
      bill({ workOrderId: 'b', invoiced: 1010, remaining: -10, unpaidCount: 1 }),
      bill({ workOrderId: 'c', figuresComplete: false }),
    ]);
    renderBlock();
    expect(within(screen.getByTestId('billing-milestone-a')).getByText('Paid')).toBeInTheDocument();
    const b = screen.getByTestId('billing-milestone-b');
    expect(within(b).getByText('Invoiced')).toBeInTheDocument();
    expect(within(b).getByText('Over-invoiced')).toBeInTheDocument();
    expect(within(screen.getByTestId('billing-milestone-c')).getByText("Can't total")).toBeInTheDocument();
  });

  it('AC-WOMS-011 an aged work order shows days since acceptance with its source; others show none', () => {
    h.list = q([wo(), wo({ id: 'wo-2', wo_number: 'WO-2' })]);
    h.billing = q([bill(), bill({ workOrderId: 'wo-2' })]);
    h.age = q([{ workOrderId: 'wo-1', anchorDate: '2026-10-22', days: 10 }]);
    renderBlock();
    expect(within(screen.getByTestId('billing-milestone-wo-1')).getByText('Days since acceptance, not invoiced: 10')).toBeInTheDocument();
    expect(within(screen.getByTestId('billing-milestone-wo-2')).queryByText(/Days since acceptance/)).toBeNull();
  });

  it('AC-WOMS-014 a PM sees status and value but no Invoice this', () => {
    renderBlock('Project Manager');
    const row = screen.getByTestId('billing-milestone-wo-1');
    expect(within(row).getByText('Planned')).toBeInTheDocument();
    expect(within(row).queryByText('Invoice this')).toBeNull();
    expect(within(row).queryByRole('link', { name: /Invoice WO-1/ })).toBeNull();
  });

  it('AC-WOMS-012 Invoice this links to the work order in Contract & billing with the invoice hand-off', () => {
    h.list = q([wo(), wo({ id: 'wo-2', wo_number: 'WO-2' }), wo({ id: 'wo-3', wo_number: 'WO-3', status: 'Draft' })]);
    h.billing = q([
      bill({ remaining: 80_000 }),
      bill({ workOrderId: 'wo-2', paid: 1000, invoiced: 1000, remaining: 0 }),
      bill({ workOrderId: 'wo-3', status: 'Draft' }),
    ]);
    renderBlock();
    expect(screen.getByRole('link', { name: 'Invoice WO-1' })).toHaveAttribute('href', '/projects/p1/contract?wo=wo-1&invoice=1');
    expect(screen.queryByRole('link', { name: 'Invoice WO-2' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Invoice WO-3' })).toBeNull();
  });

  it('AC-WOMS-015 a pending or failed read shows loading or error with retry, never a status, value or age', async () => {
    h.list = { ...q(undefined), isPending: true };
    const first = renderBlock();
    expect(screen.queryByTestId('billing-milestone-wo-1')).toBeNull();
    first.unmount();

    h.list = q([wo()]);
    h.billing = { ...q(undefined), isError: true };
    h.age = q([{ workOrderId: 'wo-1', anchorDate: '2026-10-22', days: 10 }]);
    const second = renderBlock();
    expect(screen.getByText("Couldn't load the billing milestones")).toBeInTheDocument();
    expect(screen.queryByTestId('billing-milestone-wo-1')).toBeNull();
    expect(screen.queryByText(/Days since acceptance/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(h.list.refetch).toHaveBeenCalled();
    expect(h.billing.refetch).toHaveBeenCalled();
    expect(h.age.refetch).toHaveBeenCalled();
    second.unmount();

    h.billing = q([bill()]);
    h.age = { ...q(undefined), isError: true };
    renderBlock();
    expect(screen.getByText("Couldn't load the billing milestones")).toBeInTheDocument();
    expect(screen.queryByTestId('billing-milestone-wo-1')).toBeNull();
  });

  it('AC-WOMS-015 no work orders says so and links to Contract & billing', () => {
    h.list = q([]);
    renderBlock();
    expect(screen.getByText(/No work orders yet\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open contract & billing' })).toHaveAttribute('href', '/projects/p1/contract');
  });
});
