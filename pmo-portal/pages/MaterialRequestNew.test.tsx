import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  tz: 'Asia/Jakarta',
  saveDraft: { mutateAsync: vi.fn().mockResolvedValue('r1'), isPending: false },
  submit: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: (id?: string) => ({
    data: id ? { projectId: 'p1', workOrderId: 'w1', neededBy: '2026-11-25', note: null, lines: [{ id: 'l1', itemId: 'i1', quantity: 2, overPlanReason: null }] } : undefined,
    isPending: false, isError: false,
  }),
  useMaterialRequestMutations: () => ({ saveDraft: h.saveDraft, submit: h.submit }),
  useLinePlans: () => ({ data: [{ itemId: 'i1', planQty: 10, priorQty: 4 }], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p1', name: 'Site Alpha', short_name: null }] }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [{ id: 'w1', title: 'Slab', wo_number: 'WO-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({ data: [{ id: 'i1', code: 'CEM', name: 'Cement', unit_id: 'u1', archived_at: null }], isPending: false, isError: false, refetch: vi.fn() }),
  useStockUnits: () => ({ data: [{ id: 'u1', code: 'BAG' }] }),
}));
vi.mock('@/src/hooks/useOrgFxContext', () => ({ useOrgFxContext: () => ({ data: { currency: 'IDR', timezone: h.tz }, isPending: false }) }));
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

  it('a refused submit leaves the draft saved and still shows why on the edit screen', async () => {
    h.saveDraft.mutateAsync.mockResolvedValueOnce('r9');
    h.submit.mutateAsync.mockRejectedValueOnce(new Error('MRQ_CUTOFF: requests for tomorrow close at 12:00; the earliest date you can request is 2026-11-22'));
    render(<MemoryRouter><ToastProvider><Routes>
      <Route path="/" element={<MaterialRequestNewPage />} />
      <Route path="/material-requests/:requestId/edit" element={<MaterialRequestNewPage />} />
    </Routes></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText(/closed at 12:00.*earliest date/)).toBeInTheDocument();
  });

  describe('AC-MRQ-022 default needed-by is tomorrow in the organisation calendar', () => {
    afterEach(() => { vi.useRealTimers(); });
    const shown = () => (screen.getByLabelText(/needed by/i) as HTMLInputElement).value;

    it('23:30 UTC on the 20th is already the 21st in UTC+7, so the default is the 22nd (UTC would say the 21st)', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:30:00Z') });
      h.tz = 'Asia/Jakarta';
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      expect(shown()).toBe('22 Nov 2026');
    });

    it('23:30 UTC is still the 20th in UTC-8, so the default is the 21st', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:30:00Z') });
      h.tz = 'America/Los_Angeles';
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      expect(shown()).toBe('21 Nov 2026');
    });

    it('the saved draft carries the organisation-calendar date', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:30:00Z') });
      h.tz = 'Asia/Jakarta';
      h.saveDraft.mutateAsync.mockClear();
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      await pick(/^project/i, 'Site Alpha');
      await pick(/^work order/i, 'WO-1 · Slab');
      await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
      await userEvent.type(screen.getByLabelText(/^quantity/i), '2');
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(h.saveDraft.mutateAsync.mock.calls[0][0].header.neededBy).toBe('2026-11-22');
    });
  });
});
