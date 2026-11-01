import { describe, it, expect } from 'vitest';
import { deriveBillingMilestoneStatus, sortBillingMilestones } from './billingMilestones';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

const row = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 1000, invoiced: 0, pending: 0,
  paid: 0, remaining: 1000, figuresComplete: true, lineCount: 0, unpaidCount: 0, ...over,
});

describe('deriveBillingMilestoneStatus (#1640 FR-WOMS-010)', () => {
  it.each([
    ['figures incomplete → unknown', 'Issued', row({ figuresComplete: false, invoiced: 500, remaining: 500 }), 'unknown', false],
    ['Draft work order → planned', 'Draft', row(), 'planned', false],
    ['nothing invoiced or pending → planned', 'Issued', row(), 'planned', false],
    ['something left → in-progress', 'Issued', row({ invoiced: 900, remaining: 100, unpaidCount: 1 }), 'in-progress', false],
    ['nothing left but a draft → in-progress', 'Issued', row({ invoiced: 950, pending: 50, remaining: 0, unpaidCount: 1 }), 'in-progress', false],
    ['all submitted, one unpaid → invoiced', 'Closed', row({ invoiced: 1000, remaining: 0, unpaidCount: 1 }), 'invoiced', false],
    ['all submitted and paid → paid', 'Closed', row({ invoiced: 1000, paid: 1000, remaining: 0 }), 'paid', false],
    ['over-invoiced and unpaid → invoiced + flag', 'Issued', row({ invoiced: 1010, remaining: -10, unpaidCount: 1 }), 'invoiced', true],
    ['sub-cent remainder rounds to zero → paid', 'Issued', row({ invoiced: 999.996, paid: 999.996, remaining: 0.004 }), 'paid', false],
  ] as const)('AC-WOMS-003 %s', (_name, status, billing, expected, over) => {
    expect(deriveBillingMilestoneStatus(status, billing)).toEqual({ status: expected, overInvoiced: over });
  });
});

describe('sortBillingMilestones (FR-WOMS-004)', () => {
  it('AC-WOMS-002 orders by end, else start, else order date; undated last; then number and id', () => {
    const wos = [
      { id: 'a', wo_number: 'WO-4', end_date: null, start_date: null, order_date: null },
      { id: 'b', wo_number: 'WO-3', end_date: '2026-12-01', start_date: '2026-11-10', order_date: null },
      { id: 'c', wo_number: 'WO-2', end_date: null, start_date: null, order_date: '2026-10-01' },
      { id: 'd', wo_number: 'WO-1', end_date: null, start_date: '2026-11-10', order_date: null },
    ];
    expect(sortBillingMilestones(wos).map((w) => w.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});
