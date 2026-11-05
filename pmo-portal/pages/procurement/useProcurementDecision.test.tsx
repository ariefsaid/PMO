/**
 * useProcurementDecision — the stage-then-commit decision workflow, tested at the hook seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/src/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/components/ui')>()),
  useToast: () => ({ toast }),
}));

import { useProcurementDecision } from './useProcurementDecision';

const PROC = {
  id: 'pr-1', title: 'Inverters', status: 'Requested', total_value: 500, currency: 'USD',
  project_id: null, project: null, requested_by: null, invoices: [], payments: [],
} as never;

const setup = () => {
  const idle = { mutateAsync: vi.fn(), isPending: false };
  const mutations = {
    transition: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    createReceipt: idle, createInvoice: idle, captureVendorInvoice: idle, captureSubcontractVendorInvoice: idle,
  } as never;
  const ui = {
    setTab: vi.fn(), notesInput: 'looks fine', setNotesInput: vi.fn(), setMutationError: vi.fn(),
    setShowCreateGR: vi.fn(), setShowCreateVI: vi.fn(), setShowVICapture: vi.fn(), setCaptureKind: vi.fn(),
  };
  const hook = renderHook(() => useProcurementDecision(PROC, mutations, ui));
  return { hook, ui, transition: (mutations as { transition: { mutateAsync: ReturnType<typeof vi.fn> } }).transition.mutateAsync };
};

beforeEach(() => toast.mockReset());

describe('useProcurementDecision', () => {
  it('stages a consequential transition and commits only on confirm, carrying the notes', async () => {
    const { hook, transition } = setup();
    act(() => hook.result.current.onActionClick({ to: 'Approved', label: 'Approve', variant: 'primary' } as never));
    expect(transition).not.toHaveBeenCalled();
    expect(hook.result.current.pendingConfirm).toMatchObject({ kind: 'transition', to: 'Approved', confirmLabel: 'Approve' });
    await act(() => hook.result.current.commitConfirm());
    expect(transition).toHaveBeenCalledWith({ to: 'Approved', notes: 'looks fine' });
    expect(hook.result.current.pendingConfirm).toBeNull();
  });

  it('commits a routine forward step directly with no staged confirm', async () => {
    const { hook, transition } = setup();
    await act(async () => hook.result.current.onActionClick({ to: 'Ordered', label: 'Request quotes', variant: 'primary' } as never));
    expect(transition).toHaveBeenCalledWith({ to: 'Ordered', notes: 'looks fine' });
    expect(hook.result.current.pendingConfirm).toBeNull();
  });

  it('sends the rejection comment, not the notes box, when rejecting', async () => {
    const { hook, transition } = setup();
    act(() => hook.result.current.onActionClick({ to: 'Rejected', label: 'Reject', variant: 'destructive' } as never));
    act(() => hook.result.current.setRejectionComment('  Revise quantities  '));
    await act(() => hook.result.current.commitConfirm());
    expect(transition).toHaveBeenCalledWith({ to: 'Rejected', notes: 'Revise quantities' });
  });

  it('closes the confirm and surfaces the error when the commit fails', async () => {
    const { hook, ui, transition } = setup();
    transition.mockRejectedValueOnce(new Error('boom'));
    act(() => hook.result.current.onActionClick({ to: 'Approved', label: 'Approve', variant: 'primary' } as never));
    await act(() => hook.result.current.commitConfirm());
    expect(hook.result.current.pendingConfirm).toBeNull();
    expect(ui.setMutationError).toHaveBeenLastCalledWith(expect.any(String));
    expect(toast).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'warning');
  });
});
