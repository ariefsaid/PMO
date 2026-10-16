import { describe, expect, it, vi } from 'vitest';
vi.unmock('@/src/hooks/useProjectsMoneyCollection');
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { repo, auth } = vi.hoisted(() => ({
  repo: { collection: vi.fn() },
  auth: { orgId: 'org-1' as string | null, role: 'Finance' as string },
}));
vi.mock('@/src/lib/repositories/projectMoney', () => ({ projectMoneyRepository: repo }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.orgId ? { org_id: auth.orgId, role: auth.role } : null }) }));

import { useProjectsMoneyCollection } from './useProjectsMoneyCollection';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = (queryClient: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

describe('useProjectsMoneyCollection', () => {
  it('AC-S02-007: fetches the visible ID set once and returns the per-project read model', async () => {
    const data = { p1: { actuals: { currency: 'USD', total: '10', asOf: null, excludesRestrictedRows: false, complete: true, categories: [] }, activeBudgetAmount: '100', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
    repo.collection.mockResolvedValue(data);
    const { result } = renderHook(() => useProjectsMoneyCollection(['p2', 'p1']), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(repo.collection).toHaveBeenCalledTimes(1);
    expect(repo.collection).toHaveBeenCalledWith(['p1', 'p2']);
    expect(result.current.data).toEqual(data);
  });

  it('chunks large collections into calls of at most 500 IDs and merges the read models', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `p${String(index).padStart(4, '0')}`);
    repo.collection.mockImplementation(async (chunk: string[]) => Object.fromEntries(chunk.map((id) => [id, { id }])));
    const { result } = renderHook(() => useProjectsMoneyCollection(ids), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(repo.collection).toHaveBeenCalledTimes(3);
    expect(repo.collection.mock.calls.map(([chunk]) => chunk.length)).toEqual([500, 500, 1]);
    expect(result.current.data).toHaveProperty('p0000');
    expect(result.current.data).toHaveProperty('p1000');
    expect(Object.keys(result.current.data ?? {})).toHaveLength(1001);
  });

  it('C5: Engineer role disables the money collection request', () => {
    auth.role = 'Engineer';
    repo.collection.mockClear();
    const { result } = renderHook(() => useProjectsMoneyCollection(['p1']), { wrapper: wrapper(client()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(repo.collection).not.toHaveBeenCalled();
    auth.role = 'Finance';
  });

  it('AC-S02-007: empty projects do not trigger an RPC', () => {
    repo.collection.mockClear();
    const { result } = renderHook(() => useProjectsMoneyCollection([]), { wrapper: wrapper(client()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(repo.collection).not.toHaveBeenCalled();
  });
});
