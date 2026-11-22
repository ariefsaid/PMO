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
import { allowedActions, stateMainAction } from '@/src/lib/procurement/mainAction';
import { createInstance } from 'i18next';
import en from '../../public/locales/en/procurementRecord.json';
import id from '../../public/locales/id/procurementRecord.json';

const PROC = {
  id: 'pr-1', title: 'Inverters', status: 'Requested', total_value: 500, currency: 'USD',
  project_id: null, project: null, requested_by: null, invoices: [], payments: [],
} as never;

const setup = (proc: never = PROC) => {
  const idle = { mutateAsync: vi.fn(), isPending: false };
  const mutations = {
    transition: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    createReceipt: idle, createInvoice: idle, captureVendorInvoice: idle, captureSubcontractVendorInvoice: idle,
  } as never;
  const ui = {
    setTab: vi.fn(), notesInput: 'looks fine', setNotesInput: vi.fn(), setMutationError: vi.fn(),
    setShowCreateGR: vi.fn(), setShowCreateVI: vi.fn(), setShowVICapture: vi.fn(), setCaptureKind: vi.fn(), openSupplierPicker: vi.fn(),
  };
  const hook = renderHook(() => useProcurementDecision(proc, mutations, ui));
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
    await act(async () => hook.result.current.onActionClick({ to: 'Received', label: 'Confirm receipt', variant: 'primary' } as never));
    expect(transition).toHaveBeenCalledWith({ to: 'Received', notes: 'looks fine' });
    expect(hook.result.current.pendingConfirm).toBeNull();
  });

  it('sends the rejection comment, not the notes box, when rejecting', async () => {
    const { hook, transition } = setup();
    act(() => hook.result.current.onActionClick({ to: 'Rejected', label: 'Reject', variant: 'destructive' } as never));
    act(() => hook.result.current.setRejectionComment('  Revise quantities  '));
    await act(() => hook.result.current.commitConfirm());
    expect(transition).toHaveBeenCalledWith({ to: 'Rejected', notes: 'Revise quantities' });
  });

  it('keeps the confirm staged for retry and surfaces the error when the commit fails', async () => {
    const { hook, ui, transition } = setup();
    transition.mockRejectedValueOnce(new Error('boom'));
    act(() => hook.result.current.onActionClick({ to: 'Approved', label: 'Approve', variant: 'primary' } as never));
    await act(() => hook.result.current.commitConfirm());
    // A failed confirm keeps its dialog open with the staged payload inside (r2-f3c ruling:
    // the refusal stays visible; a retry repeats the exact, already-confirmed attempt).
    expect(hook.result.current.pendingConfirm).toMatchObject({ kind: 'transition', to: 'Approved', confirmLabel: 'Approve' });
    expect(ui.setMutationError).toHaveBeenLastCalledWith(expect.any(String));
    expect(toast).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'warning');
  });

  describe('JOB-PU1 recording an order', () => {
    const WITH_SUPPLIER = { ...(PROC as object), status: 'Approved', total_value: 45000000, currency: 'IDR', vendor_id: 'v-1', vendor: { name: 'Toko Baja' } } as never;
    const NO_SUPPLIER = { ...(PROC as object), status: 'Approved', total_value: 45000000, currency: 'IDR', vendor_id: null, vendor: null } as never;
    const order = { to: 'Ordered', label: 'Record order', variant: 'primary' } as never;

    it('does not record the order on one tap: it stages a confirm naming the supplier and the amount', async () => {
      const { hook, transition } = setup(WITH_SUPPLIER);
      act(() => hook.result.current.onActionClick(order));
      expect(transition).not.toHaveBeenCalled();
      const staged = hook.result.current.pendingConfirm as { kind: string; to: string; description: string };
      expect(staged).toMatchObject({ kind: 'transition', to: 'Ordered' });
      expect(staged.description).toContain('Toko Baja');
      expect(staged.description).toMatch(/45[.,]000[.,]000/);
      await act(() => hook.result.current.commitConfirm());
      expect(transition).toHaveBeenCalledWith({ to: 'Ordered', notes: 'looks fine' });
    });

    it.each([{ language: 'en', resource: en, label: 'Record order' }, { language: 'id', resource: id, label: 'Catat pesanan' }])('uses the header wording in the confirmation in $language', async ({ language, resource, label }) => {
      const i18n = createInstance();
      await i18n.init({ lng: language, resources: { [language]: { procurementRecord: resource } }, initImmediate: false });
      for (const status of ['Approved', 'Quote Selected'] as const) {
        const actions = allowedActions(status, 'Admin', false, false, i18n.t.bind(i18n), true, false, true);
        const main = stateMainAction(status, actions, i18n.t.bind(i18n));
        expect(main?.label).toBe(label);
        const { hook, transition } = setup(WITH_SUPPLIER);
        act(() => hook.result.current.onActionClick(main!.transition));
        expect(transition).not.toHaveBeenCalled();
        expect(hook.result.current.pendingConfirm).toMatchObject({ to: 'Ordered', confirmLabel: label });
        await act(() => hook.result.current.commitConfirm());
        expect(transition).toHaveBeenCalledWith({ to: 'Ordered', notes: 'looks fine' });
      }
    });

    it('without a supplier it opens the supplier picker and records nothing', () => {
      const { hook, ui, transition } = setup(NO_SUPPLIER);
      act(() => hook.result.current.onActionClick(order));
      expect(transition).not.toHaveBeenCalled();
      expect(hook.result.current.pendingConfirm).toBeNull();
      expect(ui.openSupplierPicker).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith('Choose the supplier first', expect.stringContaining('needs its supplier'), 'warning');
    });

    it('when the database refuses an order for a missing supplier, the person is sent to the supplier picker, not shown the code', async () => {
      const { hook, ui, transition } = setup(WITH_SUPPLIER);
      transition.mockRejectedValueOnce(Object.assign(new Error('ORDER_NEEDS_SUPPLIER: choose the supplier before the order is recorded'), { code: '23514' }));
      act(() => hook.result.current.onActionClick(order));
      await act(() => hook.result.current.commitConfirm());
      expect(ui.openSupplierPicker).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith('Choose the supplier first', expect.any(String), 'warning');
      expect(JSON.stringify(toast.mock.calls)).not.toContain('ORDER_NEEDS_SUPPLIER');
    });
  });
});
