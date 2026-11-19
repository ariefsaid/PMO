import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/** #2519 — the split editor's live sum (FR-WPVA-022) and the plan editor's save path (FR-WPVA-001/002). */
const h = vi.hoisted(() => ({ setSplit: vi.fn(), clearSplit: vi.fn(), savePlan: vi.fn(), deletePlan: vi.fn() }));
vi.mock('@/src/hooks/useWorkOrderPlanVsActual', () => ({
  useSetSharedSplit: () => ({ mutateAsync: h.setSplit }),
  useClearSharedSplit: () => ({ mutateAsync: h.clearSplit }),
  useSavePlanLine: () => ({ mutateAsync: h.savePlan }),
  useDeletePlanLine: () => ({ mutateAsync: h.deletePlan }),
}));

import SharedCostSplitModal, { splitSum } from '../SharedCostSplitModal';
import WorkOrderPlanModal, { planValueProblem } from '../WorkOrderPlanModal';

const wo = (id: string, n: string) => ({ id, woNumber: n, title: n, status: 'Issued' as const, currency: 'IDR', revenue: null, revenueComplete: false });

beforeEach(() => { for (const f of Object.values(h)) f.mockReset(); });

describe('splitSum / planValueProblem', () => {
  it('sums exactly in millionths and refuses an unreadable entry', () => {
    expect(splitSum(['33.3333', '33.3333', '33.3334'])).toBe(1000000n);
    expect(splitSum(['50', 'x'])).toBeNull();
  });
  it('accepts blank or a non-negative number with up to 2 decimals', () => {
    expect(planValueProblem('')).toBeNull();
    expect(planValueProblem('1200.50')).toBeNull();
    expect(planValueProblem('-1')).toBe('format');
    expect(planValueProblem('1.234')).toBe('format');
  });
});

describe('SharedCostSplitModal', () => {
  it('AC-WPVA-006 shows the live total and only saves a split of exactly 100%', async () => {
    render(<SharedCostSplitModal projectId="p1" workOrders={[wo('A', 'WO-1'), wo('B', 'WO-2')]} split={null} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('WO-1 (%)'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('WO-2 (%)'), { target: { value: '30' } });
    expect(screen.getByTestId('wo-split-sum').textContent).toMatch(/90.*must be exactly 100%/);
    fireEvent.submit(screen.getByLabelText('WO-1 (%)').closest('form') as HTMLFormElement);
    expect(h.setSplit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('WO-2 (%)'), { target: { value: '40' } });
    expect(screen.getByTestId('wo-split-sum').textContent).not.toMatch(/must be/);
    fireEvent.submit(screen.getByLabelText('WO-1 (%)').closest('form') as HTMLFormElement);
    await waitFor(() => expect(h.setSplit).toHaveBeenCalledWith([{ workOrderId: 'A', percent: '60' }, { workOrderId: 'B', percent: '40' }]));
  });
});

describe('WorkOrderPlanModal', () => {
  it('creates new figures, updates changed ones and removes a cleared one', async () => {
    const onClose = vi.fn();
    render(<WorkOrderPlanModal projectId="p1" workOrder={wo('A', 'WO-1')} onClose={onClose}
      plans={[{ id: 'pl1', workOrderId: 'A', disciplineId: null, kind: 'crew_hours', value: '40.00', note: null }]} />);
    fireEvent.change(screen.getByLabelText('Direct budget (IDR)'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText('Crew hours'), { target: { value: '' } });
    fireEvent.submit(screen.getByLabelText('Crew hours').closest('form') as HTMLFormElement);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.savePlan).toHaveBeenCalledWith({
      input: { projectId: 'p1', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '1500', note: null }, existingId: null,
    });
    expect(h.deletePlan).toHaveBeenCalledWith('pl1');
  });

  it('refuses a negative figure before sending anything', async () => {
    render(<WorkOrderPlanModal projectId="p1" workOrder={wo('A', 'WO-1')} onClose={() => {}} plans={[]} />);
    fireEvent.change(screen.getByLabelText('Equipment hours'), { target: { value: '-3' } });
    fireEvent.submit(screen.getByLabelText('Equipment hours').closest('form') as HTMLFormElement);
    await screen.findAllByText(/zero or more/);
    expect(h.savePlan).not.toHaveBeenCalled();
  });
});
