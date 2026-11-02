import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CompiledPanel } from '@/src/lib/viewspec/types';

const exec = vi.fn();
vi.mock('@/src/lib/viewspec/executor', () => ({ executeCompiledQuery: (q: unknown) => exec(q) }));

import { usePanelQueries } from './usePanelQueries';

const panel = (id: string): CompiledPanel => ({ id, primitive: 'KPITile', compiledQuery: { entity: id } as never });
const deferred = <T,>() => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('usePanelQueries', () => {
  beforeEach(() => { exec.mockReset(); });

  it('settles each panel on its own: a fast panel is ready while a slow one still loads', async () => {
    const slow = deferred<unknown[]>();
    exec.mockImplementation((q: { entity: string }) => { return q.entity === 'slow' ? slow.promise : Promise.resolve([{ v: 1 }]); });
    const panels = [panel('fast'), panel('slow')];
    const { result } = renderHook(() => usePanelQueries(panels));
    await act(async () => {});
    expect(result.current.states.fast).toEqual({ loading: false, data: [{ v: 1 }], error: null });
    expect(result.current.states.slow.loading).toBe(true);
    await act(async () => { slow.resolve([{ v: 2 }]); });
    expect(result.current.states.slow.data).toEqual([{ v: 2 }]);
  });

  it('drops a retry that finishes after the panels were replaced', async () => {
    const first = deferred<unknown[]>();
    exec.mockRejectedValueOnce(new Error('boom'));
    const a = [panel('p1')];
    const { result, rerender } = renderHook(({ p }) => usePanelQueries(p), { initialProps: { p: a } });
    await act(async () => {});
    expect(result.current.states.p1.error).toBeInstanceOf(Error);

    exec.mockReturnValueOnce(first.promise);
    act(() => { result.current.retry(a[0]); });
    expect(result.current.states.p1.loading).toBe(true);

    // view changes: a new panel set reusing the same panel id
    exec.mockResolvedValueOnce([{ v: 'new view' }]);
    rerender({ p: [panel('p1')] });
    await act(async () => {});
    expect(result.current.states.p1.data).toEqual([{ v: 'new view' }]);

    await act(async () => { first.resolve([{ v: 'stale retry' }]); });
    expect(result.current.states.p1.data).toEqual([{ v: 'new view' }]);
  });

  it('does not write a retry result onto another panel', async () => {
    exec.mockResolvedValue([]);
    const panels = [panel('a'), panel('b')];
    const { result } = renderHook(() => usePanelQueries(panels));
    await act(async () => {});
    exec.mockResolvedValueOnce([{ only: 'a' }]);
    await act(async () => { result.current.retry(panels[0]); });
    expect(result.current.states.a.data).toEqual([{ only: 'a' }]);
    expect(result.current.states.b.data).toEqual([]);
  });
});
