import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { rollupProject, type CostAmountLine, type PvaWorkOrder } from '@/src/lib/workOrderPlanVsActual';

/**
 * #2669 — profit per discipline renders what `disciplineProfit` joined, in words: nothing while the setting is off
 * (AC-DPR-001/002, and no revenue is asked for), restricted as restricted (AC-DPR-012), a loss as "Loss of X".
 */
vi.unmock('@/pages/project-detail/DisciplineProfit'); // test/setup.ts stubs it for the contract-area suites
const h = vi.hoisted(() => ({
  setting: { data: true } as Record<string, unknown>, pva: {} as Record<string, unknown>, revenue: {} as Record<string, unknown>,
  role: 'Finance' as string, revenueAsked: [] as boolean[],
  lookupError: false, retryLookup: vi.fn(),
}));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => h.setting }));
vi.mock('@/src/hooks/useDisciplineProfit', () => ({
  useDisciplineRevenue: (_p: string, enabled: boolean) => { h.revenueAsked.push(enabled); return h.revenue; },
}));
vi.mock('@/src/hooks/useWorkOrderPlanVsActual', () => ({ useProjectPlanVsActual: () => h.pva }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ isError: h.lookupError, refetch: h.retryLookup, data: [{ id: 'civ', code: 'CIV', name: 'Civil' }, { id: 'ele', code: 'ELE', name: 'Electrical' }] }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await import('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role as never }) };
});

import DisciplineProfit from '../DisciplineProfit';

const wo: PvaWorkOrder = { id: 'A', woNumber: 'WO-1', title: 'A', status: 'Issued', currency: 'USD', revenue: '0.00', revenueComplete: true };
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: Math.random().toString(), projectId: 'p1', workOrderId: 'A', disciplineId: null, occurredOn: null,
  reference: null, currency: 'USD', amount: '0.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null, ...extra,
});
const rev = (disciplineId: string | null, revenue: string, unratedLines = 0) =>
  ({ basis: 'validated_progress', disciplineId, currency: 'USD', revenue, validatedLines: 1, unratedLines });

function setData(revenue: unknown) {
  const rollup = rollupProject({ workOrders: [wo], lines: [line({ disciplineId: 'civ', amount: '60.00' }), line({ disciplineId: 'ele', amount: '40.00' }), line({ workOrderId: null, amount: '10.00' })], plans: [], split: null, restricted: false });
  h.pva = { isPending: false, isError: false, refetch: vi.fn(), data: { workOrders: [wo], plans: [], split: null, rollup } };
  h.revenue = { isPending: false, isError: false, refetch: vi.fn(), data: revenue };
}

beforeEach(() => { h.role = 'Finance'; h.setting = { data: true }; h.revenueAsked = []; });

describe('DisciplineProfit', () => {
  it('shows a retryable error when discipline names fail to load', () => {
    setData([rev('civ', '100.00')]);
    h.lookupError = true;
    const view = render(<DisciplineProfit projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.retryLookup).toHaveBeenCalled();
    h.lookupError = false;
    view.rerender(<DisciplineProfit projectId="p1" />);
    expect(screen.getByText('Civil')).toBeInTheDocument();
  });
  it('AC-DPR-013 shows revenue beside cost and the margin per discipline, with a project total', () => {
    setData([rev('civ', '100.00'), rev('ele', '30.00')]);
    render(<DisciplineProfit projectId="p1" />);
    const civil = screen.getByTestId('discipline-profit-row-civ');
    expect(within(civil).getByText('Civil')).toBeTruthy();
    expect(within(civil).getByTestId('discipline-profit-after').textContent).toMatch(/34/);
    expect(within(civil).getByTestId('discipline-profit-before').textContent).toMatch(/40/);
    const total = screen.getByTestId('discipline-profit-row-total');
    expect(within(total).getByTestId('discipline-profit-after').textContent).toMatch(/20/); // 130 - 110
  });

  it('AC-DPR-009 states a loss in words', () => {
    setData([rev('civ', '100.00'), rev('ele', '30.00')]);
    render(<DisciplineProfit projectId="p1" />);
    expect(within(screen.getByTestId('discipline-profit-row-ele')).getByTestId('discipline-profit-after').textContent).toMatch(/^Loss of .*14/);
  });

  it('AC-DPR-008 names an incomplete figure instead of showing a number', () => {
    setData([rev('civ', '100.00', 1)]);
    render(<DisciplineProfit projectId="p1" />);
    expect(within(screen.getByTestId('discipline-profit-row-civ')).getByTestId('discipline-profit-after').textContent).toMatch(/Incomplete/);
  });

  it('AC-DPR-001/002 renders nothing, and asks for no revenue, while the setting is off', () => {
    h.setting = { data: false };
    setData([]);
    const { container } = render(<DisciplineProfit projectId="p1" />);
    expect(container.innerHTML).toBe('');
    expect(h.revenueAsked.every((asked) => asked === false)).toBe(true);
  });

  it('AC-DPR-012 reads restricted, never zero, when the revenue read is refused', () => {
    setData('restricted');
    render(<DisciplineProfit projectId="p1" />);
    expect(screen.getByRole('status').textContent).toBe('Restricted');
    expect(screen.queryByTestId('discipline-profit-row-civ')).toBeNull();
  });

  it('#2896 re-asks a refused revenue read once and recovers without a reload', () => {
    vi.useFakeTimers();
    try {
      setData('restricted');
      const view = render(<DisciplineProfit projectId="p1" />);
      expect(screen.getByRole('status').textContent).toBe('Restricted');
      vi.advanceTimersByTime(1_000);
      expect(h.revenue.refetch).toHaveBeenCalledTimes(1);
      expect(h.pva.refetch).not.toHaveBeenCalled();
      setData([rev('civ', '100.00')]);
      view.rerender(<DisciplineProfit projectId="p1" />);
      expect(screen.getByTestId('discipline-profit-row-civ')).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('renders nothing for a role that cannot read work-order money', () => {
    h.role = 'Engineer';
    setData([rev('civ', '1.00')]);
    const { container } = render(<DisciplineProfit projectId="p1" />);
    expect(container.innerHTML).toBe('');
  });

  it('says so when there is nothing yet', () => {
    h.pva = { isPending: false, isError: false, refetch: vi.fn(), data: { workOrders: [], plans: [], split: null, rollup: rollupProject({ workOrders: [], lines: [], plans: [], split: null, restricted: false }) } };
    h.revenue = { isPending: false, isError: false, refetch: vi.fn(), data: [] };
    render(<DisciplineProfit projectId="p1" />);
    expect(screen.getByRole('status').textContent).toMatch(/No validated revenue/);
  });
});
