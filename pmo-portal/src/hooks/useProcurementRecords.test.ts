/**
 * useProcurementRecordMutations — mutation-key smoke test + task FIX-1 (Discover CRITICAL 1)
 * graduation: the hook calls the `repositories.procurement.*` seam (not the DAL directly), so a
 * flipped ownership map genuinely dispatches externally instead of silently local-writing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { procurement } = vi.hoisted(() => ({
  procurement: {
    createPurchaseRequest: vi.fn(),
    createRfq: vi.fn(),
    createPurchaseOrder: vi.fn(),
    createPayment: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement } }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }),
}));

import { useProcurementRecordMutations } from './useProcurementRecords';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearOwnershipCache();
});

describe('useProcurementRecordMutations — mutation key smoke test', () => {
  it('returns createPurchaseRequest mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createPurchaseRequest.mutateAsync).toBe('function');
  });

  it('returns createRfq mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createRfq.mutateAsync).toBe('function');
  });

  it('returns createPurchaseOrder mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createPurchaseOrder.mutateAsync).toBe('function');
  });

  it('returns createPayment mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createPayment.mutateAsync).toBe('function');
  });

  it('returns an idle pendingPush by default (PMO-owned org)', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(result.current.pendingPush).toEqual({ status: 'idle', error: null });
  });
});

// ---------------------------------------------------------------------------
// task FIX-1 (Discover CRITICAL 1) — cold ownership map: byte-for-byte, direct
// repository call, pendingPush stays idle.
// ---------------------------------------------------------------------------
describe('task FIX-1 — cold ownership map (PMO-owned) — createPurchaseOrder calls the repository directly', () => {
  it('calls repositories.procurement.createPurchaseOrder with the exact args and stays idle', async () => {
    procurement.createPurchaseOrder.mockResolvedValue({ id: 'po-1' });
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });

    await act(async () => {
      await result.current.createPurchaseOrder.mutateAsync({
        referenceNumber: 'PO-0001',
        status: 'Draft',
        date: '2026-07-13',
        amount: 500,
      });
    });

    expect(procurement.createPurchaseOrder).toHaveBeenCalledWith('proc1', 'PO-0001', 'Draft', '2026-07-13', 500, undefined);
    expect(result.current.pendingPush).toEqual({ status: 'idle', error: null });
  });
});

// ---------------------------------------------------------------------------
// task FIX-1 — flipped ownership map routes externally + drives pendingPush
// idle -> pushing -> pushed / push-failed (the P1 idiom).
// ---------------------------------------------------------------------------
describe('task FIX-1 — flipped ownership map routes createPurchaseOrder externally + drives pendingPush', () => {
  beforeEach(() => setTaskOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]));
  afterEach(() => clearOwnershipCache());

  it('holds and refreshes line eligibility around an external case command', async () => {
    let resolveCreate!: (value: unknown) => void;
    procurement.createPurchaseOrder.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ['procurement-item-eligibility', 'org1', 'proc1'];
    qc.setQueryData(key, true);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const Wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper: Wrapper });
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.createPurchaseOrder.mutateAsync({ referenceNumber: 'PO', status: 'Draft', date: '2026-07-13', amount: 100 }); });
    await waitFor(() => expect(qc.getQueryData(key)).toBe(false));
    await act(async () => { resolveCreate({ id: 'po-1' }); await pending; });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  });

  it('cycles pendingPush idle -> pushing -> pushed on success', async () => {
    let resolveCreate!: (v: unknown) => void;
    procurement.createPurchaseOrder.mockReturnValue(new Promise((res) => (resolveCreate = res)));

    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(result.current.pendingPush.status).toBe('idle');

    let mutatePromise!: Promise<unknown>;
    act(() => {
      mutatePromise = result.current.createPurchaseOrder.mutateAsync({
        referenceNumber: 'PO-0002',
        status: 'Draft',
        date: '2026-07-13',
        amount: 750,
      });
    });

    await waitFor(() => expect(result.current.pendingPush.status).toBe('pushing'));

    await act(async () => {
      resolveCreate({ id: 'po-ext-1' });
      await mutatePromise;
    });

    expect(result.current.pendingPush.status).toBe('pushed');
    expect(procurement.createPurchaseOrder).toHaveBeenCalledWith('proc1', 'PO-0002', 'Draft', '2026-07-13', 750, undefined);
  });

  it('sets pendingPush to push-failed on a rejected external write', async () => {
    procurement.createPurchaseOrder.mockRejectedValue(
      Object.assign(new Error('site unreachable'), { code: 'external-unreachable' }),
    );

    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });

    await act(async () => {
      await result.current.createPurchaseOrder
        .mutateAsync({ referenceNumber: 'PO-0003', status: 'Draft', date: '2026-07-13', amount: 100 })
        .catch(() => undefined);
    });

    expect(result.current.pendingPush.status).toBe('push-failed');
  });
});

describe('FR-ECA-030 a payment on a purchase ordered before the ERP connection is recorded in PMO', () => {
  beforeEach(() => setTaskOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]));

  function renderWithDetail(preCutover: boolean) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['procurement', 'org1', 'proc1', 'u1', 'Finance'], { id: 'proc1', pre_cutover: preCutover });
    const w = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
    return renderHook(() => useProcurementRecordMutations('proc1'), { wrapper: w });
  }
  const payment = { invoiceId: 'vi-1', referenceNumber: null, status: 'Scheduled', date: '2026-07-13', amount: 100 };

  it('shows no push state for the payment', async () => {
    let resolveCreate!: (v: unknown) => void;
    procurement.createPayment.mockReturnValue(new Promise((res) => (resolveCreate = res)));
    const { result } = renderWithDetail(true);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.createPayment.mutateAsync(payment); });
    await waitFor(() => expect(result.current.createPayment.isPending).toBe(true));
    expect(result.current.pendingPush.status).toBe('idle');
    await act(async () => { resolveCreate({ id: 'pay-1' }); await pending; });
    expect(result.current.pendingPush.status).toBe('idle');
  });

  it('still shows the push state for a purchase order on the same case (that one is sent)', async () => {
    let resolveCreate!: (v: unknown) => void;
    procurement.createPurchaseOrder.mockReturnValue(new Promise((res) => (resolveCreate = res)));
    const { result } = renderWithDetail(true);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.createPurchaseOrder.mutateAsync({ referenceNumber: 'PO-1', status: 'Draft', date: '2026-07-13', amount: 1 }); });
    await waitFor(() => expect(result.current.pendingPush.status).toBe('pushing'));
    await act(async () => { resolveCreate({ id: 'po-1' }); await pending; });
  });

  it('a purchase ordered after the connection shows the push state for its payment', async () => {
    let resolveCreate!: (v: unknown) => void;
    procurement.createPayment.mockReturnValue(new Promise((res) => (resolveCreate = res)));
    const { result } = renderWithDetail(false);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.createPayment.mutateAsync(payment); });
    await waitFor(() => expect(result.current.pendingPush.status).toBe('pushing'));
    await act(async () => { resolveCreate({ id: 'pay-1' }); await pending; });
  });
});
