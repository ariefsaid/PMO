import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { rollupProject, type CostAmountLine, type PvaWorkOrder, type PlanLine, type SplitPercent } from '@/src/lib/workOrderPlanVsActual';

/**
 * #2519 — the plan-vs-actual card renders what `rollupProject` derived, in words: overspend as "Over plan by X"
 * (AC-WPVA-014), a stale split as such (AC-WPVA-007), a restricted read as restricted (AC-WPVA-009), equipment
 * days apart from hours (AC-WPVA-013), and a role without the permission sees nothing.
 */
vi.unmock('@/pages/project-detail/WorkOrderPlanVsActual'); // test/setup.ts stubs it for the contract-area suites
const h = vi.hoisted(() => ({ query: {} as Record<string, unknown>, role: 'Finance' as string }));
vi.mock('@/src/hooks/useWorkOrderPlanVsActual', () => ({
  useProjectPlanVsActual: () => h.query,
  useSavePlanLine: () => ({ mutateAsync: vi.fn() }),
  useDeletePlanLine: () => ({ mutateAsync: vi.fn() }),
  useSetSharedSplit: () => ({ mutateAsync: vi.fn() }),
  useClearSharedSplit: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({
  useCostDisciplines: () => ({ data: [{ id: 'civ', code: 'CIV', name: 'Civil' }] }),
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await import('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role as never }) };
});

import WorkOrderPlanVsActual from '../WorkOrderPlanVsActual';

const wo = (id: string, n: string, extra: Partial<PvaWorkOrder> = {}): PvaWorkOrder =>
  ({ id, woNumber: n, title: `Title ${n}`, status: 'Issued', currency: 'IDR', revenue: '1000.00', revenueComplete: true, ...extra });
let seq = 0;
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: `r${++seq}`, projectId: 'p1', workOrderId: null, disciplineId: null, occurredOn: null,
  reference: null, currency: 'IDR', amount: '0.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null, ...extra,
});

function setData(input: { workOrders: PvaWorkOrder[]; lines: CostAmountLine[]; plans?: PlanLine[]; split?: SplitPercent[] | null; restricted?: boolean }) {
  const plans = input.plans ?? [];
  const split = input.split ?? null;
  h.query = {
    isPending: false, isError: false, refetch: vi.fn(),
    data: { workOrders: input.workOrders, plans, split, rollup: rollupProject({ workOrders: input.workOrders, lines: input.lines, plans, split, restricted: input.restricted ?? false }) },
  };
}

beforeEach(() => { h.role = 'Finance'; });

describe('WorkOrderPlanVsActual', () => {
  it('AC-WPVA-014 states overspend in words, with direct, shared and both margins', () => {
    setData({
      workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2', { revenue: '500.00' })],
      lines: [line({ workOrderId: 'A', amount: '600.00' }), line({ workOrderId: 'B', amount: '400.00' }), line({ amount: '100.00' })],
      plans: [{ id: 'p', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '550.00', note: null }],
    });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    const a = screen.getByTestId('wo-pva-row-A');
    expect(within(a).getByTestId('wo-pva-direct').textContent).toMatch(/Over plan by .*50/);
    expect(within(a).getByTestId('wo-pva-allocated').textContent).toMatch(/60/);
    expect(within(a).getByTestId('wo-pva-result').textContent).toMatch(/340/);
    expect(screen.getByTestId('wo-pva-total-IDR').textContent).toMatch(/1[.,]100/);
    expect(screen.getAllByTestId('wo-pva-basis-note')[0].textContent).toMatch(/share of direct cost/);
  });

  it('AC-WPVA-007 says a saved split is stale and that the default is used', () => {
    setData({
      workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2'), wo('C', 'WO-3')],
      lines: [line({ workOrderId: 'A', amount: '10.00' }), line({ amount: '5.00' })],
      split: [{ workOrderId: 'A', percent: '50' }, { workOrderId: 'B', percent: '50' }],
    });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(screen.getAllByTestId('wo-pva-basis-note').map((n) => n.textContent).join(' ')).toMatch(/stale.*default is used/);
  });

  it('AC-WPVA-009 a restricted read shows restricted, never a zero', () => {
    setData({ workOrders: [wo('A', 'WO-1')], lines: [], restricted: true });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(screen.getByRole('status').textContent).toMatch(/restricted for your role/);
    expect(screen.queryByTestId('wo-pva-row-A')).toBeNull();
  });

  it('AC-WPVA-010 a cost in another currency makes margin "not comparable"', () => {
    setData({ workOrders: [wo('A', 'WO-1')], lines: [line({ workOrderId: 'A', amount: '10.00' }), line({ workOrderId: 'A', amount: '1.00', currency: 'USD' })] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(within(screen.getByTestId('wo-pva-row-A')).getByTestId('wo-pva-direct-margin').textContent).toMatch(/Not comparable/);
  });

  it('AC-WPVA-013 the basis shows equipment hours and keeps days apart; every line says how it counts', () => {
    setData({
      workOrders: [wo('A', 'WO-1')],
      lines: [
        line({ workOrderId: 'A', source: 'equipment_usage', amount: null, reason: 'no-rate', quantity: 6, quantityUnit: 'hours' }),
        line({ workOrderId: 'A', source: 'equipment_usage', amount: null, reason: 'no-rate', quantity: 1, quantityUnit: 'days' }),
        line({ workOrderId: 'A', source: 'purchase_order', amount: null, reason: 'commitment', reference: 'PO-1' }),
      ],
    });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    fireEvent.click(within(screen.getByTestId('wo-pva-row-A')).getByRole('button', { name: 'Basis' }));
    expect(screen.getByText('Equipment hours').nextSibling?.textContent).toMatch(/^6/);
    expect(screen.getByText('Equipment days (kept apart)').nextSibling?.textContent).toBe('1');
    expect(screen.getByText(/Commitment, not summed/)).toBeTruthy();
  });

  it('AC-WPVA-015 the split action is offered to Finance, not to a Project Manager; an Engineer sees no card', () => {
    setData({ workOrders: [wo('A', 'WO-1')], lines: [] });
    const { unmount } = render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Shared-cost split' })).toBeTruthy();
    unmount();
    h.role = 'Project Manager';
    const pm = render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(screen.queryByRole('button', { name: 'Shared-cost split' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Plan' })).toBeTruthy();
    pm.unmount();
    h.role = 'Engineer';
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(screen.queryByTestId('wo-plan-vs-actual')).toBeNull();
  });
});
