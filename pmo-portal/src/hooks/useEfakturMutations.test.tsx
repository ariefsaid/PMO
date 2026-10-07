import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  salesSetEfaktur: vi.fn().mockResolvedValue(undefined),
  procurementSetEfaktur: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: { setEfaktur: mocks.salesSetEfaktur },
    procurement: { setEfaktur: mocks.procurementSetEfaktur },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));

import { useRevenueMutations } from './useRevenue';
import { useProcurementMutations } from './useProcurementDetail';

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.salesSetEfaktur.mockClear();
  mocks.procurementSetEfaktur.mockClear();
});

describe('PMO-owned e-Faktur mutations', () => {
  it('AC-EFK-004 writes sales facts directly and invalidates revenue query families', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRevenueMutations(), { wrapper: makeWrapper(queryClient) });

    await act(async () => {
      await result.current.setEfaktur.mutateAsync({
        siId: 'si-1', efakturNumber: '010.001', efakturDate: null,
      });
    });

    expect(mocks.salesSetEfaktur).toHaveBeenCalledWith('si-1', { efakturNumber: '010.001', efakturDate: null });
    expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([
      ['salesInvoices'], ['salesInvoice'], ['incomingPayments'], ['incomingPayment'], ['revenueByProject'],
      ['work-order-billing'], ['unbilled-work-orders'],
    ]);
  });

  it('AC-EFK-005 writes vendor facts directly and invalidates the org-scoped procurement detail', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: makeWrapper(queryClient) });

    await act(async () => {
      await result.current.setEfaktur.mutateAsync({
        invoiceId: 'vi-1', efakturNumber: null, efakturDate: '2026-10-01',
      });
    });

    expect(mocks.procurementSetEfaktur).toHaveBeenCalledWith('vi-1', { efakturNumber: null, efakturDate: '2026-10-01' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['procurement', 'org-1', 'proc-1'] });
    expect(result.current.pendingPush.status).toBe('idle');
  });

  it('AC-EFK-004 a known setter refusal (the row went stale) refetches the sales list; an unknown failure does not', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRevenueMutations(), { wrapper: makeWrapper(queryClient) });

    mocks.salesSetEfaktur.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '23514', details: 'efaktur-cancelled' }));
    await act(async () => {
      await result.current.setEfaktur.mutateAsync({ siId: 'si-1', efakturNumber: '010-01', efakturDate: '2026-10-01' }).catch(() => undefined);
    });
    expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toContainEqual(['salesInvoices']);

    invalidate.mockClear();
    mocks.salesSetEfaktur.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42501' }));
    await act(async () => {
      await result.current.setEfaktur.mutateAsync({ siId: 'si-1', efakturNumber: '010-01', efakturDate: '2026-10-01' }).catch(() => undefined);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('AC-EFK-005 a known setter refusal refetches the procurement detail behind the ledger', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useProcurementMutations('proc-1'), { wrapper: makeWrapper(queryClient) });

    mocks.procurementSetEfaktur.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '23514', details: 'efaktur-cancelled' }));
    await act(async () => {
      await result.current.setEfaktur.mutateAsync({ invoiceId: 'vi-1', efakturNumber: '010-01', efakturDate: '2026-10-01' }).catch(() => undefined);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['procurement', 'org-1', 'proc-1'] });
  });
});
