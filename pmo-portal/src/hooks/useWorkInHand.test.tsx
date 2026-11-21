import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// A plain function for the refusal case: vi.fn records a rejected result on a derived promise that vitest reports as unhandled.
const h = vi.hoisted(() => ({ get: vi.fn(), failWith: null as Error | null }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workInHand: { get: () => (h.failWith ? Promise.reject(h.failWith) : h.get()) } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { useWorkInHand } from './useWorkInHand';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { h.get.mockReset(); h.failWith = null; });

describe('useWorkInHand (#2575)', () => {
  it('reads once through the repository and derives Left to bill and the rate from the server as-of date', async () => {
    h.get.mockResolvedValue({
      asOf: '2026-12-10', orgCurrency: 'IDR', rows: [{
        kind: 'contract', id: 'c', parentId: null, name: 'C', code: null, status: 'Ongoing Project', currency: 'IDR', value: '1200000.00',
        incomplete: false, foreignCurrencyInvoiceCount: 0, unpricedInvoiceCount: 0, billedToDate: '340000.00', firstBillingMonth: '2026-09-01',
        windowMonths: [{ month: '2026-09-01', billed: '100000.00' }, { month: '2026-10-01', billed: '150000.00' }, { month: '2026-11-01', billed: '50000.00' }],
      }],
    });
    const { result } = renderHook(() => useWorkInHand(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(result.current.rows[0].backlogTenths).toBe(86n);
  });

  it('surfaces a refusal as an error and derives nothing', async () => {
    h.failWith = Object.assign(new Error('not authorized'), { code: '42501' });
    const { result } = renderHook(() => useWorkInHand(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toEqual([]);
  });
});
