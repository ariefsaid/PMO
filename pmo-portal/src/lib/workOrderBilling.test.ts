import { describe, it, expect } from 'vitest';
import {
  canInvoiceWorkOrder, deriveWorkOrderBillingState, invoiceAmountProblem, summarizeProjectWorkOrderBilling,
} from './workOrderBilling';
import type { WorkOrderBillingRow } from './db/workOrderBilling';

const bill = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 500_000, invoiced: 330_000,
  pending: 90_000, paid: 100_000, remaining: 80_000, figuresComplete: true, lineCount: 6, unpaidCount: 3, ...over,
});

describe('deriveWorkOrderBillingState (OD-BILL-1)', () => {
  it.each([
    ['partly invoiced', bill(), 'partly-invoiced'],
    ['not invoiced', bill({ invoiced: 0, pending: 0, paid: 0, remaining: 500_000, lineCount: 0, unpaidCount: 0 }), 'not-invoiced'],
    ['fully invoiced, some unpaid', bill({ invoiced: 500_000, pending: 0, remaining: 0, unpaidCount: 2 }), 'fully-invoiced'],
    ['fully invoiced with a draft', bill({ invoiced: 450_000, pending: 50_000, remaining: 0, unpaidCount: 0 }), 'fully-invoiced'],
    ['paid', bill({ invoiced: 500_000, pending: 0, paid: 500_000, remaining: 0, unpaidCount: 0 }), 'paid'],
    ['over-invoiced', bill({ remaining: -1_000 }), 'over-invoiced'],
    ['cannot total', bill({ figuresComplete: false }), 'incomplete'],
  ] as const)('AC-BWO-004 %s', (_label, row, state) => {
    expect(deriveWorkOrderBillingState('Issued', row)).toBe(state);
  });
  it('AC-BWO-004 a Draft or Cancelled work order is not billable; an exact-to-the-cent remainder is zero', () => {
    expect(deriveWorkOrderBillingState('Draft', bill({ invoiced: 0, pending: 0, remaining: 500_000, lineCount: 0 }))).toBe('not-billable');
    expect(deriveWorkOrderBillingState('Cancelled', bill())).toBe('not-billable');
    expect(deriveWorkOrderBillingState('Closed', bill({ invoiced: 500_000, pending: 0, paid: 500_000, remaining: 0.004, unpaidCount: 0 }))).toBe('paid');
  });
});

describe('canInvoiceWorkOrder', () => {
  it('AC-BWO-004 only an Issued or Closed work order with something left and figures that total', () => {
    expect(canInvoiceWorkOrder('Issued', bill())).toBe(true);
    expect(canInvoiceWorkOrder('Closed', bill())).toBe(true);
    expect(canInvoiceWorkOrder('Draft', bill())).toBe(false);
    expect(canInvoiceWorkOrder('Issued', bill({ remaining: 0 }))).toBe(false);
    expect(canInvoiceWorkOrder('Issued', bill({ remaining: -5 }))).toBe(false);
    expect(canInvoiceWorkOrder('Issued', bill({ figuresComplete: false }))).toBe(false);
  });
});

describe('summarizeProjectWorkOrderBilling', () => {
  it('AC-UNB-002 adds Issued and Closed work orders; an over-invoiced one adds nothing left; Draft/Cancelled are ignored', () => {
    const rows = [
      bill(),
      bill({ workOrderId: 'wo-2', status: 'Closed', invoiced: 105_000, pending: 0, paid: 0, remaining: -5_000 }),
      bill({ workOrderId: 'wo-3', status: 'Draft', invoiced: 0, pending: 0, paid: 0, remaining: 900_000 }),
    ];
    expect(summarizeProjectWorkOrderBilling(rows)).toEqual({ invoiced: 435_000, paid: 100_000, stillToInvoice: 80_000, complete: true });
  });
  it('AC-UNB-002 one untotallable work order makes the totals incomplete', () => {
    expect(summarizeProjectWorkOrderBilling([bill(), bill({ workOrderId: 'wo-2', figuresComplete: false })]).complete).toBe(false);
  });
  it('sums in cents', () => {
    expect(summarizeProjectWorkOrderBilling([bill({ invoiced: 0.1, paid: 0, remaining: 0.2 }), bill({ workOrderId: 'wo-2', invoiced: 0.2, paid: 0, remaining: 0.1 })]))
      .toMatchObject({ invoiced: 0.3, stillToInvoice: 0.3 });
  });
});

describe('invoiceAmountProblem', () => {
  it('AC-BWO-004 refuses unreadable, zero and over-the-rest amounts; equal is fine', () => {
    expect(invoiceAmountProblem(null, 100)).toBe('invalid');
    expect(invoiceAmountProblem(0, 100)).toBe('not-positive');
    expect(invoiceAmountProblem(100.01, 100)).toBe('over-remaining');
    expect(invoiceAmountProblem(100, 100)).toBeNull();
  });
});
