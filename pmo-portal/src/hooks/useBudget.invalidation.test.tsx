import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider, useQueries } from '@tanstack/react-query';
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

  it('waits for every active read under one prefix after another matching read rejects', async () => {
    const queryClient = new QueryClient({
      queryCache: new QueryCache({ onError: () => undefined }),
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const slowRead = deferred<string>();
    const calls = [0, 0];
    const { result } = renderHook(() => useQueries({ queries: [
      {
        queryKey: ['budget-distribution', 'org-1', 'project-1', 'draft-a'],
        queryFn: () => {
          calls[0] += 1;
          return calls[0] === 1 ? Promise.resolve('initial') : Promise.reject(new Error('first read failed'));
        },
      },
      {
        queryKey: ['budget-distribution', 'org-1', 'project-1', 'draft-b'],
        queryFn: () => {
          calls[1] += 1;
          return calls[1] === 1 ? Promise.resolve('initial') : slowRead.promise;
        },
      },
    ] }), { wrapper });
    await waitFor(() => expect(result.current.every((query) => query.data === 'initial')).toBe(true));

    let settled = false;
    let refreshError: unknown;
    const reconciliation = refreshBudgetQueries(queryClient, 'org-1', 'project-1')
      .catch((error: unknown) => { refreshError = error; })
      .then(() => { settled = true; });
    await waitFor(() => expect(calls).toEqual([2, 2]));
    const stayedPending = !settled;

    await act(async () => {
      slowRead.resolve('fresh');
      await reconciliation;
    });

    expect(stayedPending).toBe(true);
    expect(settled).toBe(true);
    expect(refreshError).toBeInstanceOf(Error);
    expect(calls[0]).toBeGreaterThanOrEqual(2);
    expect(calls[1]).toBeGreaterThanOrEqual(2);
  });

  it('refreshes the org-scoped forecast readers without refetching unrelated tenants or projects', async () => {
    const queryClient = new QueryClient({
      queryCache: new QueryCache({ onError: () => undefined }),
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const families = [
      'budget-comparison',
      'budget-projection',
      'active-budget-category-phasing',
      'budget-fiscal-years',
    ] as const;
    const cases = families.flatMap((family) => [
      // The readers all key by [family, orgId, projectId, ...]; a project-only key is not a real shape.
      { key: [family, 'project-1', 'active-scope'], relevant: false },
      { key: [family, 'org-1', 'project-1', 'draft-1', 'annual-scope'], relevant: true },
      { key: [family, 'org-2', 'project-1', 'draft-1'], relevant: false },
      { key: [family, 'org-1', 'project-2', 'draft-1'], relevant: false },
    ]);
    const calls = cases.map(() => 0);
    const queries = cases.map(({ key }, index) => ({
      queryKey: key,
      queryFn: () => {
        calls[index] += 1;
        return Promise.resolve(calls[index]);
      },
    }));
    const { result } = renderHook(() => useQueries({ queries }), { wrapper });
    await waitFor(() => expect(result.current.every((query) => query.data === 1)).toBe(true));

    await refreshBudgetQueries(queryClient, 'org-1', 'project-1');

    expect(calls).toEqual(cases.map(({ relevant }) => relevant ? 2 : 1));
  });

  it('refetches a query only once when several prefixes match it', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    let calls = 0;
    const { result } = renderHook(() => useQueries({ queries: [{
      queryKey: ['budget-comparison', 'shared-id', 'shared-id', 'draft-1'],
      queryFn: () => {
        calls += 1;
        return Promise.resolve(calls);
      },
    }] }), { wrapper });
    await waitFor(() => expect(result.current[0].data).toBe(1));

    await refreshBudgetQueries(queryClient, 'shared-id', 'shared-id');

    expect(calls).toBe(2);
  });

  it('keeps existing mutation invalidation fire-and-forget when a refresh fails', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('read failed'));

    expect(() => invalidateBudgetQueries(queryClient, 'org-1', 'project-1')).not.toThrow();
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
