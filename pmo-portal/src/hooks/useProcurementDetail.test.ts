import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the DAL
// ---------------------------------------------------------------------------
vi.mock('@/src/lib/db/procurementLifecycle', () => ({
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
  transitionProcurement: vi.fn().mockResolvedValue(undefined),
  createQuotation: vi.fn().mockResolvedValue({ id: 'quote-1' }),
  createReceipt: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
  createInvoice: vi.fn().mockResolvedValue({ id: 'invoice-1' }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }),
}));

import { useProcurementDetail, useProcurementMutations } from './useProcurementDetail';
import {
  getProcurementDetail,
  transitionProcurement,
  createQuotation,
  createReceipt,
  createInvoice,
} from '@/src/lib/db/procurementLifecycle';

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
  beforeEach(() => vi.clearAllMocks());

  it('AC-816 (hook): useProcurementMutations.transition invalidates the detail key on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.transition.mutateAsync({ to: 'Requested', notes: undefined });
    });

    expect(transitionProcurement).toHaveBeenCalledWith('proc-1', 'Requested', undefined);
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some(
        (c) =>
          c.includes('"procurement"') && c.includes('"org-1"') && c.includes('"proc-1"'),
      ),
    ).toBe(true);
  });

  it('AC-816 (hook): createReceipt mutation invalidates the detail key on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createReceipt.mutateAsync({
        status: 'Partial',
        receiptDate: '2026-06-04',
      });
    });

    expect(createReceipt).toHaveBeenCalledWith('proc-1', 'Partial', '2026-06-04');
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some(
        (c) =>
          c.includes('"procurement"') && c.includes('"org-1"') && c.includes('"proc-1"'),
      ),
    ).toBe(true);
  });

  it('AC-816 (hook): createInvoice mutation invalidates the detail key on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.createInvoice.mutateAsync({
        status: 'Received',
        invoiceDate: '2026-06-04',
      });
    });

    expect(createInvoice).toHaveBeenCalledWith('proc-1', 'Received', '2026-06-04');
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some((c) => c.includes('"procurement"') && c.includes('"org-1"')),
    ).toBe(true);
  });

  it('AC-816 (hook): createQuotation mutation invalidates the detail key on success', async () => {
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

    expect(createQuotation).toHaveBeenCalledWith('proc-1', 'vendor-1', 50000, '2026-06-04');
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(
      calls.some((c) => c.includes('"procurement"') && c.includes('"org-1"')),
    ).toBe(true);
  });

  it('mutations are exposed: transition, createQuotation, createReceipt, createInvoice', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: Wrapper });
    expect(typeof result.current.transition.mutateAsync).toBe('function');
    expect(typeof result.current.createQuotation.mutateAsync).toBe('function');
    expect(typeof result.current.createReceipt.mutateAsync).toBe('function');
    expect(typeof result.current.createInvoice.mutateAsync).toBe('function');
  });
});
