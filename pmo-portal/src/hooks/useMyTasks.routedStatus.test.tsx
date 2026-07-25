import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * AC-CUA-001/060/061 (Slice C, C4b) — the My Tasks quick-status write must inherit the ADR-0056
 * routing seam (routeTaskWrite() + dispatchTaskCommand), not bypass it via a raw
 * `supabase.from('tasks').update(...)` call. This test drives `useMyTaskMutations().updateStatus`
 * and proves: (a) with the cache asserting tasks→clickup, the routed helper dispatches through
 * `functions.invoke('adapter-dispatch', ...)`; (b) with a PMO-owned (or empty) cache, the SAME
 * mutation still performs the direct-DAL update — byte-for-byte, never regressing the pre-P1 path.
 */

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as unknown[], update: [] as unknown[], eq: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  builder.update = (...args: unknown[]) => {
    calls.update.push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq.push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  const invoke = vi.fn(async () => ({
    data: { externalRecordId: 'cu-1', canonical: { id: 't1', status: 'Done' } },
    error: null,
  }));
  return { from, invoke, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: h.from, functions: { invoke: h.invoke } },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Engineer' }),
}));

import { useMyTaskMutations } from './useMyTasks';
import { setTaskOwnership, setProjectBindings, clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  h.from.mockClear();
  h.invoke.mockClear();
  h.calls.from.length = 0;
  h.calls.update.length = 0;
  h.calls.eq.length = 0;
  h.result.value = { data: null, error: null };
  clearOwnershipCache();
});

describe('useMyTaskMutations().updateStatus routes through the repository seam (ADR-0056)', () => {
  it('AC-CUA-001/060 externally-owned (tasks→clickup): the quick-status write dispatches via adapter-dispatch', async () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    setProjectBindings([{ projectId: 'p1', externalTier: 'clickup' }]);
    const { result } = renderHook(() => useMyTaskMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.updateStatus.mutateAsync({ id: 't1', projectId: 'p1', status: 'Done' });
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [fnName, opts] = h.invoke.mock.calls[0] as unknown as [
      string,
      { body: { domain: string; operation: string; record: { id: string; status: string } } },
    ];
    expect(fnName).toBe('adapter-dispatch');
    expect(opts.body).toEqual({ domain: 'tasks', operation: 'transition', record: { id: 't1', status: 'Done' } });
    // the raw direct update never fires when routed externally
    expect(h.calls.update).toEqual([]);
  });

  it('AC-CUA-001/061 PMO-owned (control): the quick-status write still performs the direct DAL update, byte-for-byte', async () => {
    // no setTaskOwnership() call — the cache is empty/never-loaded (fail-closed to 'pmo').
    const { result } = renderHook(() => useMyTaskMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.updateStatus.mutateAsync({ id: 't1', projectId: 'p1', status: 'Done' });
    });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.update).toEqual([{ status: 'Done' }]);
    expect(h.calls.eq).toContainEqual(['id', 't1']);
  });
});
