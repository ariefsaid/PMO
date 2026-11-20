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
  useSaveWorkOrderPlan: () => ({ mutateAsync: vi.fn() }),
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

function setData(input: { workOrders: PvaWorkOrder[]; lines: CostAmountLine[]; plans?: PlanLine[]; split?: SplitPercent[] | null; restricted?: boolean; projectRevenue?: Array<{ currency: string; work_revenue: string | null; missing_work: number }> }) {
  const plans = input.plans ?? [];
  const split = input.split ?? null;
  h.query = {
    isPending: false, isError: false, refetch: vi.fn(),
    data: { workOrders: input.workOrders, plans, split, rollup: rollupProject({ workOrders: input.workOrders, lines: input.lines, plans, split, restricted: input.restricted ?? false, projectRevenue: input.projectRevenue }) },
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

  it('shows order value as the ceiling beside billed revenue', () => {
    setData({ workOrders: [wo('A', 'WO-1', { orderValue: '1500.00' })], lines: [] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(within(screen.getByTestId('wo-pva-row-A')).getByText(/Order value/).textContent).toMatch(/1[.,]500/);
  });

  it('shows project hours and distinct crew alongside their plans', () => {
    setData({ workOrders: [wo('A', 'WO-1')],
      plans: [{ id: 'p', workOrderId: 'A', disciplineId: null, kind: 'crew_hours', value: '20.00', note: null }],
      lines: [line({ workOrderId: 'A', source: 'timesheet_entry', reason: 'no-rate', amount: null, quantity: 7, quantityUnit: 'hours', personId: 'u1' })] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    const summary = screen.getByTestId('wo-pva-project-hours');
    expect(summary.textContent).toMatch(/7/);
    expect(summary.textContent).toMatch(/20/);
    expect(summary.textContent).toMatch(/1/);
  });

  it('AC-WPVA-017 crew hours count approved weeks only and say how many hours are not yet approved', () => {
    setData({ workOrders: [wo('A', 'WO-1')],
      plans: [{ id: 'p', workOrderId: 'A', disciplineId: null, kind: 'crew_hours', value: '5.00', note: null }],
      lines: [
        line({ workOrderId: 'A', source: 'timesheet_entry', reason: 'no-rate', amount: null, quantity: 4, quantityUnit: 'hours', personId: 'u1' }),
        line({ workOrderId: 'A', source: 'timesheet_entry', reason: 'not-posted', amount: null, quantity: 6, quantityUnit: 'hours', personId: 'u2' }),
      ] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    const summary = screen.getByTestId('wo-pva-project-hours');
    expect(summary.textContent).toMatch(/Crew hours4/);
    expect(summary.textContent).toMatch(/6 h on timesheets not yet approved are not counted/);
    fireEvent.click(within(screen.getByTestId('wo-pva-row-A')).getAllByRole('button')[0]);
    expect(screen.queryByText(/Over plan by/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/6 h on timesheets not yet approved are not counted/).length).toBe(2);
  });

  it('states project direct-cost overspend in words', () => {
    setData({ workOrders: [wo('A', 'WO-1')], lines: [line({ workOrderId: 'A', amount: '60.00' })],
      plans: [{ id: 'p', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '50.00', note: null }] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(within(screen.getByTestId('wo-pva-total-IDR')).getByText(/Over plan by/).textContent).toMatch(/10/);
  });

  it('shows project and contract revenue and margins in the total row', () => {
    setData({ workOrders: [wo('A', 'WO-1')], lines: [line({ workOrderId: 'A', amount: '60.00' }), line({ amount: '40.00', reason: 'unassigned' }),
      line({ source: 'other_revenue', reason: 'other-revenue', amount: '30.00' })],
      plans: [{ id: 'a', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '150.00', note: null },
        { id: 'b', workOrderId: 'A', disciplineId: null, kind: 'indirect_budget', value: '25.00', note: null }],
      projectRevenue: [{ currency: 'IDR', work_revenue: '200.00', missing_work: 0 }] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    const total = screen.getByTestId('wo-pva-total-IDR');
    expect(total.textContent).toMatch(/150/);
    expect(total.textContent).toMatch(/25/);
    expect(total.textContent).toMatch(/200/);
    expect(total.textContent).toMatch(/140/);
    expect(total.textContent).toMatch(/100/);
    expect(screen.getByText('Other revenue').closest('tr')?.textContent).toMatch(/30/);
  });

  it('states other revenue even when its billed amount is zero', () => {
    setData({ workOrders: [wo('A', 'WO-1')], projectRevenue: [{ currency: 'IDR', work_revenue: '0.00', missing_work: 0 }],
      lines: [line({ source: 'other_revenue', reason: 'other-revenue', amount: '0.00' })] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(screen.getByText('Other revenue').closest('tr')?.textContent).toMatch(/0/);
  });

  it('shows planned and actual cost by discipline', () => {
    setData({ workOrders: [wo('A', 'WO-1')], lines: [line({ workOrderId: 'A', disciplineId: 'civ', amount: '60.00' })],
      plans: [{ id: 'p', workOrderId: 'A', disciplineId: 'civ', kind: 'direct_budget', value: '100.00', note: null },
        { id: 'q', workOrderId: 'A', disciplineId: 'civ', kind: 'indirect_budget', value: '20.00', note: null }] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    const table = screen.getByTestId('wo-pva-disciplines');
    expect(within(table).getByText('Planned direct')).toBeTruthy();
    expect(within(table).getByText('Planned indirect')).toBeTruthy();
    expect(table.textContent).toMatch(/100/);
    expect(table.textContent).toMatch(/20/);
    expect(table.textContent).toMatch(/60/);
  });

  it('states discipline overspend in words', () => {
    setData({ workOrders: [wo('A', 'WO-1')], lines: [line({ workOrderId: 'A', disciplineId: 'civ', amount: '60.00' })],
      plans: [{ id: 'p', workOrderId: 'A', disciplineId: 'civ', kind: 'direct_budget', value: '50.00', note: null }] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(within(screen.getByTestId('wo-pva-disciplines')).getByText(/Over plan by/).textContent).toMatch(/10/);
  });

  it('shows unassigned project cost even when no work orders exist', () => {
    setData({ workOrders: [], lines: [line({ amount: '25.00', reason: 'unassigned' })] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    expect(screen.getByText('No work orders on this project yet.')).toBeTruthy();
    expect(screen.getByTestId('wo-pva-not-assigned-IDR').textContent).toMatch(/25/);
    expect(screen.getByTestId('wo-pva-total-IDR').textContent).toMatch(/25/);
  });

  it('names each currency when allocation bases differ', () => {
    setData({ workOrders: [wo('A', 'WO-1'), wo('B', 'WO-2', { currency: 'USD' })],
      lines: [line({ workOrderId: 'A', amount: '100.00' }), line({ currency: 'USD', amount: '10.00' })] });
    render(<WorkOrderPlanVsActual projectId="p1" />);
    const notes = screen.getAllByTestId('wo-pva-basis-note').map((node) => node.textContent).join(' ');
    expect(notes).toMatch(/IDR.*share of direct cost/);
    expect(notes).toMatch(/USD.*remains unassigned/);
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
    const basis = screen.getByTestId('wo-pva-row-A').nextElementSibling as HTMLElement;
    expect(within(basis).getByText('Equipment hours').nextSibling?.textContent).toMatch(/^6/);
    expect(within(basis).getByText('Equipment days (kept apart)').nextSibling?.textContent).toBe('1');
    expect(within(basis).getByText(/Commitment, not summed/)).toBeTruthy();
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
