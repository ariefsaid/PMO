import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { rollupProject, type CostAmountLine, type PvaWorkOrder } from '@/src/lib/workOrderPlanVsActual';

/**
 * #2733 — earned and billed revenue renders what `earnedBilledProfit` joined: nothing while the setting is off (AC-EBR-001,
 * and no revenue is asked for), not available and restricted in words (AC-EBR-004/010), a loss as "Loss of X" (AC-EBR-008).
 */
vi.unmock('@/pages/project-detail/EarnedBilledProfit'); // test/setup.ts stubs it for the contract-area suites
const h = vi.hoisted(() => ({
  setting: { data: true } as Record<string, unknown>, pva: {} as Record<string, unknown>, eb: {} as Record<string, unknown>,
  revenue: {} as Record<string, unknown>, role: 'Finance' as string, asked: [] as boolean[],
}));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => h.setting }));
vi.mock('@/src/hooks/useDisciplineProfit', () => ({
  useDisciplineRevenue: () => h.revenue,
}));
vi.mock('@/src/hooks/useEarnedBilled', () => ({ useWorkOrderEarnedBilled: (_p: string, enabled: boolean) => { h.asked.push(enabled); return h.eb; } }));
vi.mock('@/src/hooks/useWorkOrderPlanVsActual', () => ({ useProjectPlanVsActual: () => h.pva }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'civ', code: 'CIV', name: 'Civil' }] }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await import('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role as never }) };
});

import EarnedBilledProfit from '../EarnedBilledProfit';

const wo: PvaWorkOrder = { id: 'A', woNumber: 'WO-1', title: 'Road', status: 'Issued', currency: 'USD', revenue: '60.00', revenueComplete: true };
const cost: CostAmountLine = {
  source: 'vendor_bill', recordId: 'r1', projectId: 'p1', workOrderId: 'A', disciplineId: 'civ', occurredOn: null, reference: null,
  currency: 'USD', amount: '70.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null,
};
const ebRow = (extra: Record<string, unknown> = {}) =>
  ({ workOrderId: 'A', currency: 'USD', earned: '100.00', earnedLines: 1, unratedLines: 0, billed: '60.00', billedComplete: true, ...extra });
const rev = (basis: string, disciplineId: string | null, revenue: string) =>
  ({ basis, disciplineId, currency: 'USD', revenue, validatedLines: 1, unratedLines: 0 });

function setData(eb: unknown, revenue: unknown = []) {
  const rollup = rollupProject({
    workOrders: [wo], lines: [cost], plans: [], split: null, restricted: false,
    projectRevenue: [{ currency: 'USD', work_revenue: '60.00', missing_work: 0 }],
  });
  h.pva = { isPending: false, isError: false, refetch: vi.fn(), data: { workOrders: [wo], plans: [], split: null, rollup } };
  h.eb = { isPending: false, isError: false, refetch: vi.fn(), data: eb };
  h.revenue = { isPending: false, isError: false, refetch: vi.fn(), data: revenue };
}

beforeEach(() => { h.role = 'Finance'; h.setting = { data: true }; h.asked = []; });

describe('EarnedBilledProfit', () => {
  it('AC-EBR-011 shows earned beside billed, the gap and the margin on each basis, with a project total', () => {
    setData([ebRow()], [rev('validated_progress', 'civ', '100.00'), rev('billed_claims', 'civ', '70.00'), rev('billed_unitemised', null, '10.00')]);
    render(<EarnedBilledProfit projectId="p1" />);
    const row = screen.getByTestId('earned-billed-row-A');
    expect(within(row).getByText('WO-1 · Road')).toBeTruthy();
    expect(screen.getByTestId('earned-billed-row-A-earned').textContent).toMatch(/100/);
    expect(screen.getByTestId('earned-billed-row-A-billed').textContent).toMatch(/60/);
    expect(screen.getByTestId('earned-billed-row-A-gap').textContent).toMatch(/40/);
    expect(screen.getByTestId('earned-billed-row-A-marginEarned').textContent).toMatch(/30/);
    expect(screen.getByTestId('earned-billed-row-A-marginBilled').textContent).toMatch(/^Loss of .*10/);
    expect(screen.getByTestId('earned-billed-row-total-gap').textContent).toMatch(/40/);
    expect(screen.getByTestId('earned-billed-discipline-unitemised-billed').textContent).toMatch(/10/);
  });

  it('AC-EBR-004 no validated progress reads Not available, never zero, and the count is stated', () => {
    setData([ebRow({ earned: null, earnedLines: 0 })]);
    render(<EarnedBilledProfit projectId="p1" />);
    expect(screen.getByTestId('earned-billed-row-A-earned').textContent).toBe('Not available');
    expect(screen.getByTestId('earned-billed-row-A-gap').textContent).toBe('Not available');
    expect(screen.getByTestId('earned-billed-row-A-marginEarned').textContent).toBe('Not available');
    expect(screen.getByTestId('earned-billed-without-progress').textContent).toMatch(/1 of 1/);
  });

  it('AC-EBR-010 a caller who cannot see revenue reads Restricted', () => {
    setData('restricted', 'restricted');
    render(<EarnedBilledProfit projectId="p1" />);
    expect(screen.getByRole('status').textContent).toBe('Restricted');
  });

  // #2896: a refused read used to pin the panel closed until a reload — the refusal is cached as a successful
  // result, so nothing ever re-asked. The panel re-asks the refused read once and recovers when it succeeds.
  it('#2896 a refused earned/billed read is re-asked once and the panel recovers without a reload', () => {
    vi.useFakeTimers();
    try {
      setData('restricted', 'restricted');
      const view = render(<EarnedBilledProfit projectId="p1" />);
      expect(screen.getByRole('status').textContent).toBe('Restricted');
      expect(h.eb.refetch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      // the refused read is the one re-asked; a read that succeeded is not re-read
      expect(h.eb.refetch).toHaveBeenCalledTimes(1);
      expect(h.pva.refetch).not.toHaveBeenCalled();
      setData([ebRow()], [rev('validated_progress', 'civ', '100.00')]);
      view.rerender(<EarnedBilledProfit projectId="p1" />);
      expect(screen.getByTestId('earned-billed-row-A-earned').textContent).toMatch(/100/);
      expect(screen.queryByRole('status')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('#2896 a refused plan-versus-actual read is re-asked too: it feeds the same restricted state', () => {
    vi.useFakeTimers();
    try {
      setData([], []);
      h.pva = {
        isPending: false, isError: false, refetch: vi.fn(),
        data: { workOrders: [], plans: [], split: null, rollup: rollupProject({ workOrders: [], lines: [], plans: [], split: null, restricted: true, projectRevenue: null }) },
      };
      render(<EarnedBilledProfit projectId="p1" />);
      expect(screen.getByRole('status').textContent).toBe('Restricted');
      vi.advanceTimersByTime(1_000);
      expect(h.pva.refetch).toHaveBeenCalledTimes(1);
      expect(h.eb.refetch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('#2896 still restricted after the one re-ask stays restricted: the re-ask never loops', () => {
    vi.useFakeTimers();
    try {
      setData('restricted', 'restricted');
      render(<EarnedBilledProfit projectId="p1" />);
      vi.advanceTimersByTime(1_000);
      expect(h.eb.refetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10_000);
      expect(h.eb.refetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status').textContent).toBe('Restricted');
    } finally { vi.useRealTimers(); }
  });

  it('AC-EBR-001/002 renders nothing, and asks for no revenue, while the setting is off or the role cannot read work-order money', () => {
    setData([ebRow()]);
    h.setting = { data: false };
    const off = render(<EarnedBilledProfit projectId="p1" />);
    expect(off.container.textContent).toBe('');
    expect(h.asked.every((a) => a === false)).toBe(true);
    off.unmount();
    h.setting = { data: true }; h.role = 'Engineer'; h.asked = [];
    const eng = render(<EarnedBilledProfit projectId="p1" />);
    expect(eng.container.textContent).toBe('');
    expect(h.asked.every((a) => a === false)).toBe(true);
  });
});

it('JOB-M12 an executive sees invoiced and claimed amounts labelled on the project total', () => {
  h.role = 'Executive';
  setData([ebRow({ billed: '80.00' })], [rev('billed_claims', 'civ', '70.00'), rev('billed_unitemised', null, '10.00')]);
  render(<EarnedBilledProfit projectId="p1" />);
  const total = screen.getByTestId('earned-billed-row-total-billed');
  expect(total).toHaveTextContent(/Invoiced.*60/);
  expect(total).toHaveTextContent(/Claimed.*80/);
  expect(screen.getByTestId('earned-billed-row-A-billed')).toHaveTextContent(/80/);
});
it('JOB-M12 missing work-order progress has its own explanation, distinct from unrated work', () => {
  setData([ebRow(), ebRow({ workOrderId: 'B', earned: null, earnedLines: 0 })]);
  render(<EarnedBilledProfit projectId="p1" />);
  expect(screen.getByTestId('earned-billed-row-total-earned')).toHaveTextContent('Incomplete: some work orders have no validated progress');
});
