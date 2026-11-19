import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  saveDraft: { mutateAsync: vi.fn().mockResolvedValue('r1'), isPending: false },
  submit: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: () => ({ data: undefined, isPending: false, isError: false }),
  useMaterialRequestMutations: () => ({ saveDraft: h.saveDraft, submit: h.submit }),
  useLinePlans: () => ({ data: [{ itemId: 'i1', planQty: 10, priorQty: 4 }], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p1', name: 'Site Alpha', short_name: null }] }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [{ id: 'w1', title: 'Slab', wo_number: 'WO-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({ data: [{ id: 'i1', code: 'CEM', name: 'Cement', unit_id: 'u1', archived_at: null }], isPending: false, isError: false, refetch: vi.fn() }),
  useStockUnits: () => ({ data: [{ id: 'u1', code: 'BAG' }] }),
}));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestNewPage from './MaterialRequestNew';

const pick = async (label: RegExp, option: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

describe('raise a material request', () => {
  it('AC-MRQ-001 an over-plan line asks for a reason and cannot be sent without one', async () => {
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '8');
    expect(screen.getByTestId('mrq-plan')).toHaveTextContent('Plan 10 · already requested 4 · new total 12');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText(/Give a reason/)).toBeInTheDocument();
    expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Why do you need more/), 'Extra slab pour');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(h.saveDraft.mutateAsync).toHaveBeenCalledOnce();
    expect(h.saveDraft.mutateAsync.mock.calls[0][0].lines).toEqual([{ itemId: 'i1', quantity: 8, overPlanReason: 'Extra slab pour' }]);
    expect(h.submit.mutateAsync).toHaveBeenCalledOnce();
  });

  it('a line within plan shows no reason field', async () => {
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '3');
    expect(screen.queryByLabelText(/Why do you need more/)).not.toBeInTheDocument();
  });
});
