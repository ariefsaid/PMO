import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { CompiledPanel } from '@/src/lib/viewspec/types';

const exec = vi.fn();
vi.mock('@/src/lib/viewspec/executor', () => ({ executeCompiledQuery: (q: unknown) => exec(q) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { usePanelQueries } from './usePanelQueries';

const panel = (id: string): CompiledPanel => ({ id, primitive: 'KPITile', compiledQuery: { entity: id } as never });
const deferred = <T,>() => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

describe('usePanelQueries', () => {
  beforeEach(() => { exec.mockReset(); client.clear(); });

  it('settles each panel on its own: a fast panel is ready while a slow one still loads', async () => {
    const slow = deferred<unknown[]>();
    exec.mockImplementation((q: { entity: string }) => { return q.entity === 'slow' ? slow.promise : Promise.resolve([{ v: 1 }]); });
    const panels = [panel('fast'), panel('slow')];
    const { result } = renderHook(() => usePanelQueries(panels), { wrapper });
    await waitFor(() => expect(result.current.states.fast.loading).toBe(false));
    expect(result.current.states.fast).toEqual({ loading: false, data: [{ v: 1 }], error: null });
    expect(result.current.states.slow.loading).toBe(true);
    await act(async () => { slow.resolve([{ v: 2 }]); });
    await waitFor(() => expect(result.current.states.slow.data).toEqual([{ v: 2 }]));
  });

  it('shares one in-flight read when two panels have the same compiled query', async () => {
    const sameQuery = { entity: 'projects', select: ['id', 'name'] };
    const panels = [
      { ...panel('first'), compiledQuery: sameQuery as never },
      { ...panel('second'), compiledQuery: sameQuery as never },
    ];
    exec.mockResolvedValue([{ id: 'p1', name: 'Project' }]);

    const { result } = renderHook(() => usePanelQueries(panels), { wrapper });
    await waitFor(() => expect(result.current.states.first.loading).toBe(false));

    expect(exec).toHaveBeenCalledTimes(1);
    expect(result.current.states.first.data).toEqual([{ id: 'p1', name: 'Project' }]);
    expect(result.current.states.second.data).toEqual([{ id: 'p1', name: 'Project' }]);
  });

  it('drops a retry that finishes after the panels were replaced', async () => {
    const first = deferred<unknown[]>();
    exec.mockRejectedValueOnce(new Error('boom'));
    const a = [panel('p1')];
    const { result, rerender } = renderHook(({ p }) => usePanelQueries(p), { wrapper, initialProps: { p: a } });
    await waitFor(() => expect(result.current.states.p1.error).toBeInstanceOf(Error));
    expect(result.current.states.p1.error).toBeInstanceOf(Error);

    exec.mockReturnValueOnce(first.promise);
    act(() => { result.current.retry(a[0]); });
    await waitFor(() => expect(result.current.states.p1.loading).toBe(true));

    // view changes: a new panel set reusing the same panel id
    exec.mockResolvedValueOnce([{ v: 'new view' }]);
    rerender({ p: [{ ...panel('p1'), compiledQuery: { entity: 'new view' } as never }] });
    await waitFor(() => expect(result.current.states.p1.data).toEqual([{ v: 'new view' }]));

    await act(async () => { first.resolve([{ v: 'stale retry' }]); });
    expect(result.current.states.p1.data).toEqual([{ v: 'new view' }]);
  });

  it('does not write a retry result onto another panel', async () => {
    exec.mockResolvedValue([]);
    const panels = [panel('a'), panel('b')];
    const { result } = renderHook(() => usePanelQueries(panels), { wrapper });
    await waitFor(() => expect(result.current.states.a.loading).toBe(false));
    exec.mockResolvedValueOnce([{ only: 'a' }]);
    await act(async () => { result.current.retry(panels[0]); });
    await waitFor(() => expect(result.current.states.a.data).toEqual([{ only: 'a' }]));
    expect(result.current.states.b.data).toEqual([]);
  });
});
