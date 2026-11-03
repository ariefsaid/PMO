import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueries } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateBudgetQueries, refreshBudgetQueries } from './useBudget';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('refreshBudgetQueries', () => {
  it('awaits refreshed budget, totals, readiness, finances, and every distribution query for the project', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const keys = [
      ['budget', 'org-1', 'project-1'],
      ['budget-versions', 'org-1', 'project-1'],
      ['budget-activation-precheck', 'draft-1'],
      ['project-finances', 'org-1', 'project-1'],
      ['budget-distribution', 'org-1', 'project-1', 'draft-1'],
      ['budget-distribution', 'org-1', 'project-1', 'draft-2'],
    ] as const;
    const refresh = deferred<string>();
    const calls = keys.map(() => 0);
    const queries = keys.map((queryKey, index) => ({
      queryKey,
      queryFn: vi.fn(() => {
        calls[index] += 1;
        return calls[index] === 1 ? Promise.resolve('initial') : refresh.promise;
      }),
    }));
    const { result } = renderHook(() => useQueries({ queries }), { wrapper });
    await waitFor(() => expect(result.current.every((query) => query.data === 'initial')).toBe(true));

    let settled = false;
    let reconciliation!: Promise<void>;
    act(() => {
      reconciliation = refreshBudgetQueries(queryClient, 'org-1', 'project-1').then(() => { settled = true; });
    });
    await waitFor(() => expect(calls).toEqual([2, 2, 2, 2, 2, 2]));
    expect(settled).toBe(false);

    await act(async () => {
      refresh.resolve('fresh');
      await reconciliation;
    });
    expect(settled).toBe(true);
    await waitFor(() => expect(result.current.map((query) => query.data)).toEqual(Array(6).fill('fresh')));
  });

  it('rejects when an active budget read fails during reconciliation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    let calls = 0;
    const { result } = renderHook(() => useQueries({ queries: [{
      queryKey: ['budget', 'org-1', 'project-1'],
      queryFn: () => {
        calls += 1;
        if (calls > 1) throw new Error('private refresh detail');
        return 'initial';
      },
    }] }), { wrapper });
    await waitFor(() => expect(result.current[0].data).toBe('initial'));

    await expect(refreshBudgetQueries(queryClient, 'org-1', 'project-1')).rejects.toThrow();
  });

  it('keeps existing mutation invalidation fire-and-forget when a refresh fails', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('read failed'));

    expect(() => invalidateBudgetQueries(queryClient, 'org-1', 'project-1')).not.toThrow();
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledTimes(5);
  });
});
