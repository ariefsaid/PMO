import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.unmock('@/src/hooks/useWorkInHand');

// A plain function for the refusal case: vi.fn records a rejected result on a derived promise that vitest reports as unhandled.
const h = vi.hoisted(() => ({
  get: vi.fn(),
  getCapacity: vi.fn(),
  setCapacity: vi.fn(),
  failWith: null as Error | null,
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    workInHand: {
      get: () => (h.failWith ? Promise.reject(h.failWith) : h.get()),
      getCapacity: () => (h.failWith ? Promise.reject(h.failWith) : h.getCapacity()),
      setCapacity: (v: number | null) => h.setCapacity(v),
    },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { useSetWorkInHandCapacity, useWorkInHand, useWorkInHandCapacity } from './useWorkInHand';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  h.get.mockReset();
  h.getCapacity.mockReset();
  h.setCapacity.mockReset();
  h.failWith = null;
});

describe('useWorkInHand (#2575)', () => {
  it('reads once through the repository and derives Left to bill and the rate from the server as-of date', async () => {
    h.get.mockResolvedValue({
      asOf: '2026-12-10', orgCurrency: 'IDR', monthlyCapacity: '2500000.00', rows: [{
        kind: 'contract', id: 'c', parentId: null, name: 'C', code: null, status: 'Ongoing Project', currency: 'IDR', value: '1200000.00',
        incomplete: false, foreignCurrencyInvoiceCount: 0, unpricedInvoiceCount: 0, billedToDate: '340000.00', firstBillingMonth: '2026-09-01',
        windowMonths: [{ month: '2026-09-01', billed: '100000.00' }, { month: '2026-10-01', billed: '150000.00' }, { month: '2026-11-01', billed: '50000.00' }],
      }],
    });
    const { result } = renderHook(() => useWorkInHand(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(result.current.rows[0].backlogTenths).toBe(86n);
    expect(result.current.facts?.monthlyCapacity).toBe('2500000.00');
  });

  it('surfaces a refusal as an error and derives nothing', async () => {
    h.failWith = Object.assign(new Error('not authorized'), { code: '42501' });
    const { result } = renderHook(() => useWorkInHand(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toEqual([]);
  });

  it('reads and updates monthly capacity through the repository and invalidates work-in-hand queries', async () => {
    h.getCapacity.mockResolvedValue(2500000);
    h.setCapacity.mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result: capQuery } = renderHook(() => useWorkInHandCapacity(), { wrapper: wrap });
    await waitFor(() => expect(capQuery.current.isSuccess).toBe(true));
    expect(capQuery.current.data).toBe(2500000);

    const { result: capMutation } = renderHook(() => useSetWorkInHandCapacity(), { wrapper: wrap });
    await act(async () => { await capMutation.current.mutateAsync(3000000); });
    expect(h.setCapacity).toHaveBeenCalledWith(3000000);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-in-hand-capacity', 'org-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-in-hand', 'org-1'] });
  });
});
