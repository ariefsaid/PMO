import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { rollupProject, type CostAmountLine, type PvaWorkOrder } from '@/src/lib/workOrderPlanVsActual';

/** #2733 AC-EBR-012 — the pack shows earned, billed, gap and margin on both bases from the project tab's own roll-up. */
vi.unmock('@/pages/ManagementPackEarned'); // test/setup.ts stubs it for the pack suites
const h = vi.hoisted(() => ({ setting: { data: true } as Record<string, unknown>, earned: {} as Record<string, unknown>, roll: [] as unknown[], role: 'Finance' }));
vi.mock('@/src/hooks/useDisciplineProfit', () => ({ useDisciplineProfitEnabled: () => h.setting }));
vi.mock('@/src/hooks/useEarnedBilled', () => ({ usePackEarned: () => h.earned, usePackRollups: () => h.roll }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Harbour' }] }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await import('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role as never }) };
});

import ManagementPackEarned from './ManagementPackEarned';

const wo: PvaWorkOrder = { id: 'A', woNumber: 'WO-1', title: 'Road', status: 'Issued', currency: 'USD', revenue: '60.00', revenueComplete: true };
const cost: CostAmountLine = {
  source: 'vendor_bill', recordId: 'r1', projectId: 'p1', workOrderId: 'A', disciplineId: null, occurredOn: null, reference: null,
  currency: 'USD', amount: '70.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null,
};
const row = (extra: Record<string, unknown> = {}) =>
  ({ projectId: 'p1', currency: 'USD', earned: '100.00', unratedLines: 0, workOrders: 1, workOrdersWithoutProgress: 0, ...extra });

function setData(rows: unknown[]) {
  const rollup = rollupProject({ workOrders: [wo], lines: [cost], plans: [], split: null, restricted: false,
    projectRevenue: [{ currency: 'USD', work_revenue: '60.00', missing_work: 0 }] });
  h.earned = { isPending: false, isError: false, refetch: vi.fn(), data: rows };
  h.roll = rows.map(() => ({ isPending: false, isError: false, data: { workOrders: [wo], plans: [], split: null, rollup } }));
}
beforeEach(() => { h.setting = { data: true }; h.role = 'Finance'; });

describe('ManagementPackEarned', () => {
  it('AC-EBR-012 shows earned, billed, gap and margin on each basis per project, equal to the tab', () => {
    setData([row()]);
    render(<ManagementPackEarned />);
    expect(screen.getByTestId('pack-earned-row-p1-USD-earned').textContent).toMatch(/100/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-billed').textContent).toMatch(/60/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-gap').textContent).toMatch(/40/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-marginEarned').textContent).toMatch(/30/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-marginBilled').textContent).toMatch(/^Loss of .*10/);
  });

  it('AC-EBR-004 a project with work orders lacking progress reads incomplete in words', () => {
    setData([row({ workOrders: 2, workOrdersWithoutProgress: 1 })]);
    render(<ManagementPackEarned />);
    expect(screen.getByTestId('pack-earned-row-p1-USD-earned').textContent).toMatch(/^Incomplete/);
  });

  it('AC-EBR-001 renders nothing while the setting is off or the role cannot read work-order money', () => {
    setData([row()]);
    h.setting = { data: false };
    expect(render(<ManagementPackEarned />).container.textContent).toBe('');
    h.setting = { data: true }; h.role = 'Engineer';
    expect(render(<ManagementPackEarned />).container.textContent).toBe('');
  });
});
