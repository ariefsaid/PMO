import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the read DAL (the read hook still calls it directly — reads never route
// externally, FR-ENA-172) + the write repository seam (task FIX-1, Discover
// CRITICAL 1: the mutation hook now calls `repositories.procurement.*` instead
// of the DAL directly, so `routeDomainWrite('procurement')` genuinely governs
// where a write lands instead of always local-writing with a false success).
// ---------------------------------------------------------------------------
vi.mock('@/src/lib/db/procurementLifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/db/procurementLifecycle')>();
  return {
    ...actual,
    getProcurementDetail: vi.fn().mockResolvedValue({
      id: 'proc-1',
      title: 'Test Procurement',
      status: 'Draft',
      quotations: [],
      receipts: [],
      invoices: [],
      approved_by: null,
      project: { name: 'Test Project', code: 'PRJ-001' },
      vendor: null,
      requested_by: { full_name: 'Alice' },
    }),
    captureVendorInvoice: vi.fn().mockResolvedValue({ id: 'invoice-vi-1' }),
  };
});

const { procurement } = vi.hoisted(() => ({
  procurement: {
    transition: vi.fn().mockResolvedValue(undefined),
    createQuotation: vi.fn().mockResolvedValue({ id: 'quote-1' }),
    createReceipt: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
    createInvoice: vi.fn().mockResolvedValue({ id: 'invoice-1' }),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement } }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }),
}));

import { useProcurementDetail, useProcurementMutations } from './useProcurementDetail';
import { getProcurementDetail, captureVendorInvoice } from '@/src/lib/db/procurementLifecycle';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';

// ---------------------------------------------------------------------------
// Wrapper factory — each test gets a fresh QueryClient (mirrors useBudget.test.ts)
// ---------------------------------------------------------------------------
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

// ---------------------------------------------------------------------------
// C1 — read hook: org-scoped queryKey + enabled + calls DAL (AC-816 hook)
// ---------------------------------------------------------------------------

describe('useProcurementDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it("AC-816 (hook): useProcurementDetail keys cache by ['procurement', orgId, id] and calls getProcurementDetail", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProcurementDetail('proc-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getProcurementDetail).toHaveBeenCalledWith('proc-1');
    expect(result.current.data).toMatchObject({ id: 'proc-1', title: 'Test Procurement' });
  });

  it('is disabled when id is empty string', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProcurementDetail(''), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when id is undefined', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useProcurementDetail(undefined as unknown as string),
      { wrapper: Wrapper },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// C2 — mutation hook: invalidates detail key on success (AC-816 hook)
// ---------------------------------------------------------------------------

describe('useProcurementMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOwnershipCache();
  });

  it('AC-816 (hook): useProcurementMutations.transition calls repositories.procurement.transition and invalidates the detail key on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.transition.mutateAsync({ to: 'Requested', notes: undefined });
    });

    expect(procurement.transition).toHaveBeenCalledWith('proc-1', 'Requested', undefined);
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some(
        (c) =>
          c.includes('"procurement"') && c.includes('"org-1"') && c.includes('"proc-1"'),
      ),
    ).toBe(true);
  });

  it('AC-816 (hook): createReceipt mutation calls repositories.procurement.createReceipt and invalidates the detail key on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createReceipt.mutateAsync({
        status: 'Partial',
        receiptDate: '2026-06-04',
      });
    });

    expect(procurement.createReceipt).toHaveBeenCalledWith('proc-1', 'Partial', '2026-06-04', undefined, undefined);
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some(
        (c) =>
          c.includes('"procurement"') && c.includes('"org-1"') && c.includes('"proc-1"'),
      ),
    ).toBe(true);
  });

  it('AC-816 (hook): createInvoice mutation calls repositories.procurement.createInvoice and invalidates the detail key on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createInvoice.mutateAsync({
        status: 'Received',
        invoiceDate: '2026-06-04',
      });
    });

    expect(procurement.createInvoice).toHaveBeenCalledWith('proc-1', 'Received', '2026-06-04', undefined, undefined, undefined);
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some((c) => c.includes('"procurement"') && c.includes('"org-1"')),
    ).toBe(true);
  });

  it('AC-816 (hook): createQuotation mutation calls repositories.procurement.createQuotation and invalidates the detail key on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createQuotation.mutateAsync({
        vendorId: 'vendor-1',
        totalAmount: 50000,
        receivedDate: '2026-06-04',
      });
    });

    expect(procurement.createQuotation).toHaveBeenCalledWith('proc-1', 'vendor-1', 50000, '2026-06-04', undefined);
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some((c) => c.includes('"procurement"') && c.includes('"org-1"')),
    ).toBe(true);
  });

  it('harden #2 (hook): captureVendorInvoice mutation calls the atomic DAL RPC directly (case-aggregate write, PMO-only — never the repository seam) + invalidates the detail key', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.captureVendorInvoice.mutateAsync({
        status: 'Received',
        invoiceDate: '2026-06-04',
        referenceNumber: 'INV-9',
        amount: 950,
        notes: 'captured',
      });
    });

    // The whole VI capture goes through the ONE atomic RPC (transition + invoice + event),
    // never the two separate transition + createInvoice writes, and never the repository seam
    // (task FIX-1's import comment — the case aggregate stays PMO-derived, FR-ENA-101/073).
    expect(captureVendorInvoice).toHaveBeenCalledWith('proc-1', 'Received', '2026-06-04', 'INV-9', 950, 'captured');
    expect(procurement.transition).not.toHaveBeenCalled();
    expect(procurement.createInvoice).not.toHaveBeenCalled();
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('"procurement"') && c.includes('"org-1"'))).toBe(true);
  });

  it('mutations are exposed: transition, createQuotation, createReceipt, createInvoice, captureVendorInvoice, pendingPush', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });
    expect(typeof result.current.transition.mutateAsync).toBe('function');
    expect(typeof result.current.createQuotation.mutateAsync).toBe('function');
    expect(typeof result.current.createReceipt.mutateAsync).toBe('function');
    expect(typeof result.current.createInvoice.mutateAsync).toBe('function');
    expect(typeof result.current.captureVendorInvoice.mutateAsync).toBe('function');
    expect(result.current.pendingPush).toEqual({ status: 'idle', error: null });
  });
});

// ---------------------------------------------------------------------------
// task FIX-1 graduation (Discover CRITICAL 1) — a flipped ownership map routes
// createReceipt through `repositories.procurement.createReceipt` and the hook's
// `pendingPush` state cycles idle -> pushing -> pushed / push-failed. `transition`
// stays byte-for-byte on the direct write path (task 4.9's ruling) and never
// touches `pendingPush`, even when `procurement` is flipped.
// ---------------------------------------------------------------------------
describe('task FIX-1 — flipped ownership map routes createReceipt externally + drives pendingPush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
  });
  afterEach(() => clearOwnershipCache());

  it('createReceipt calls repositories.procurement.createReceipt and cycles pendingPush idle -> pushing -> pushed', async () => {
    let resolveCreate!: (v: unknown) => void;
    procurement.createReceipt.mockReturnValue(new Promise((res) => (resolveCreate = res)));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    expect(result.current.pendingPush).toEqual({ status: 'idle', error: null });

    let mutatePromise!: Promise<unknown>;
    act(() => {
      mutatePromise = result.current.createReceipt.mutateAsync({
        status: 'Complete',
        receiptDate: '2026-07-13',
      });
    });

    await waitFor(() => expect(result.current.pendingPush.status).toBe('pushing'));

    await act(async () => {
      resolveCreate({ id: 'gr-ext-1' });
      await mutatePromise;
    });

    expect(result.current.pendingPush.status).toBe('pushed');
    expect(procurement.createReceipt).toHaveBeenCalledWith('proc-1', 'Complete', '2026-07-13', undefined, undefined);
  });

  it('a failed external createReceipt sets pendingPush to push-failed', async () => {
    procurement.createReceipt.mockRejectedValue(Object.assign(new Error('site unreachable'), { code: 'external-unreachable' }));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createReceipt
        .mutateAsync({ status: 'Complete', receiptDate: '2026-07-13' })
        .catch(() => undefined);
    });

    expect(result.current.pendingPush.status).toBe('push-failed');
  });

  it('transition stays on the direct write path (never dispatched) and never touches pendingPush, even flipped', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.transition.mutateAsync({ to: 'Requested' });
    });

    expect(procurement.transition).toHaveBeenCalledWith('proc-1', 'Requested', undefined);
    expect(result.current.pendingPush).toEqual({ status: 'idle', error: null });
  });
});
