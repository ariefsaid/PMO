import { describe, expect, it } from 'vitest';
import { buildDashboardRows, type DashboardWorkOrder } from './workOrderDashboard';
import type { WorkOrderStep } from './db/workOrderBillingSteps';

const wo = (id: string): DashboardWorkOrder => ({ id, wo_number: id.toUpperCase(), title: `Order ${id}`, status: 'Issued', project_id: 'p1', project_name: 'P', end_date: null });
const step = (workOrderId: string, over: Partial<WorkOrderStep> = {}): WorkOrderStep => ({
  id: `${workOrderId}-${Math.random()}`, workOrderId, projectId: 'p1', position: 1, name: 'Step', ownerRoleKey: null, assigneeId: null,
  assigneeName: null, targetDays: null, optional: false, startedOn: null, doneOn: null, skippedOn: null, documents: [], ...over,
});

describe('buildDashboardRows (#2805)', () => {
  it('AC-WOD-001 computes progress, disciplines, open and late per work order and puts late work orders first', () => {
    const rows = buildDashboardRows({
      workOrders: [wo('a'), wo('b')],
      lines: [{ id: 'l1', work_order_id: 'a', boq_item_id: 'i1', quantity: 10 }, { id: 'l2', work_order_id: 'b', boq_item_id: 'i2', quantity: 4 }],
      items: [
        { id: 'i1', rate: 100, item_code: 'C1', unit: 'm', earning_basis: 'measured', description: 'Cable', discipline_id: 'd-elec' },
        { id: 'i2', rate: 50, item_code: 'C2', unit: 'm', earning_basis: 'measured', description: 'Pipe', discipline_id: 'd-mech' },
      ],
      acceptances: [
        { work_order_id: 'a', status: 'Confirmed', lines: [{ boq_item_id: 'i1', quantity: 5 }] },
        { work_order_id: 'b', status: 'Draft', lines: [{ boq_item_id: 'i2', quantity: 4 }] },
      ],
      steps: [step('b', { startedOn: '2026-11-01', targetDays: 3 }), step('b', { doneOn: '2026-11-02' }), step('a')],
      closeoutOverdue: new Map([['b', 2]]),
      today: '2026-11-20',
    });
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    const [b, a] = rows;
    expect(a.progress).toBe(50);
    expect(b.progress).toBe(0);
    expect(a.disciplineIds).toEqual(['d-elec']);
    expect(b.openSteps).toBe(1);
    expect(b.late).toBe(3);
    expect(a.late).toBe(0);
  });

  it('AC-CTD-010 close-out items past their due day count as late on their work order; none means no late mark', () => {
    const rows = buildDashboardRows({ workOrders: [wo('a'), wo('b')], closeoutOverdue: new Map([['a', 2]]), today: '2026-11-20' });
    expect(rows.find((r) => r.id === 'a')?.late).toBe(2);
    expect(rows.find((r) => r.id === 'b')?.late).toBe(0);
  });

  it('AC-WOD-002 an unread figure is null, never zero', () => {
    const [row] = buildDashboardRows({ workOrders: [wo('a')], today: '2026-11-20' });
    expect(row.progress).toBeNull();
    expect(row.billing).toBeNull();
    expect(row.cost).toBeNull();
  });
});
