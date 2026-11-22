import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';

const h = vi.hoisted(() => ({
  splits: null as unknown, orders: null as unknown,
  save: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestPlanSplits: () => h.splits, useSaveLineSplit: () => h.save, useDeleteLineSplit: () => h.remove,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.orders }));

import { LineSplits } from './LineSplits';

const line = { id: 'l1', plan_id: 'pl1', org_id: 'o', budget_category: 'Materials', planned_amount: 100000 } as never;
const ok = (data: unknown) => ({ data, isPending: false, isError: false });
const renderIt = (editable: boolean) => render(<ToastProvider><LineSplits planId="pl1" line={line} projectId="p1" currency="IDR" editable={editable} /></ToastProvider>);

describe('AC-CAE-013 splitting a plan line by work order', () => {
  beforeEach(() => {
    h.save.mutateAsync = vi.fn().mockResolvedValue('s1'); h.remove.mutateAsync = vi.fn().mockResolvedValue(undefined);
    h.splits = ok([{ id: 's1', line_id: 'l1', work_order_id: 'w1', amount: 60000 }]);
    h.orders = ok([{ id: 'w1', wo_number: 'WO-1', title: 'Pump house', status: 'Issued' }, { id: 'w2', wo_number: 'WO-2', title: 'Tank', status: 'Issued' },
      { id: 'w3', wo_number: 'WO-3', title: 'Old', status: 'Cancelled' }]);
  });
  it('AC-CAE-013 shows the splits and the unassigned remainder of the line', () => {
    renderIt(true);
    expect(screen.getByText('WO-1 Pump house')).toBeInTheDocument();
    expect(screen.getByText('Not assigned to a work order').parentElement).toHaveTextContent(formatCurrency(40000, 'IDR'));
  });
  it('AC-CAE-013 the author saves a split for an open work order only', async () => {
    const user = userEvent.setup();
    renderIt(true);
    await user.click(screen.getByRole('button', { name: 'Split by work order' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('WO-2 Tank');
    expect(options).not.toContain('WO-3 Old');
    await user.selectOptions(screen.getByLabelText('Work order'), 'w2');
    await user.type(screen.getByLabelText('Amount for this work order'), '25000');
    await user.click(screen.getByRole('button', { name: 'Save split' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith({ lineId: 'l1', workOrderId: 'w2', amount: 25000 }));
  });
  it('AC-CAE-013 the author removes a split', async () => {
    renderIt(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove split for WO-1 Pump house' }));
    await waitFor(() => expect(h.remove.mutateAsync).toHaveBeenCalledWith('s1'));
  });
  it('AC-CAE-013 a plan that is not editable shows the splits and no control', () => {
    renderIt(false);
    expect(screen.getByText('WO-1 Pump house')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('AC-CAE-013 a line with no splits on a plan that is not editable renders nothing', () => {
    h.splits = ok([]);
    const { container } = renderIt(false);
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-CAE-013 with no open work order the split control is disabled and says why', () => {
    h.orders = ok([{ id: 'w3', wo_number: 'WO-3', title: 'Old', status: 'Cancelled' }]);
    renderIt(true);
    expect(screen.getByRole('button', { name: 'Split by work order' })).toBeDisabled();
    expect(screen.getByTestId('split-disabled-reason')).toHaveTextContent('no open work order');
  });
  it('AC-CAE-013 a refusal from the database is said in the toast and the form keeps its values', async () => {
    h.save.mutateAsync = vi.fn().mockRejectedValue({ message: 'ICE_SPLIT_OVER_LINE: the splits would add up to 110000 against a line of 100000', code: '23514' });
    const user = userEvent.setup();
    renderIt(true);
    await user.click(screen.getByRole('button', { name: 'Split by work order' }));
    await user.selectOptions(screen.getByLabelText('Work order'), 'w2');
    await user.type(screen.getByLabelText('Amount for this work order'), '50000');
    await user.click(screen.getByRole('button', { name: 'Save split' }));
    expect(await screen.findByText(/add up to more than this plan line/)).toBeInTheDocument();
    expect(screen.getByLabelText('Amount for this work order')).toHaveValue('50000');
  });
});
