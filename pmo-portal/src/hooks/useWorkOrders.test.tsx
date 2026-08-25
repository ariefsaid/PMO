import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * useWorkOrders (#566). Two things are worth pinning at this layer:
 *
 *   1. EVERY write refreshes BOTH reads. The list and the drawdown are one view of one fact and sit
 *      on the same screen; a write that refreshes only the list leaves a stale committed total
 *      beside a fresh row — a wrong number on screen, which is the failure mode this whole feature
 *      is a control against.
 *   2. The acknowledgement is OMITTED, not defaulted, when the caller has none to make. The RPC
 *      refuses an acknowledgement attached to a non-issue transition and refuses one when nothing
 *      is over the ceiling (DD-WO-10), so passing `{ overCommitAck: false }` unconditionally would
 *      turn every cancel into a P0001.
 */
const { workOrder } = vi.hoisted(() => ({
  workOrder: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setValue: vi.fn(),
    transition: vi.fn(),
    drawdown: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProjectWorkOrders, useProjectDrawdown, useWorkOrderMutations } from './useWorkOrders';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  workOrder.list.mockResolvedValue([{ id: 'wo-1' }]);
  workOrder.drawdown.mockResolvedValue({
    committed: 1,
    draft: 0,
    ceiling: 10,
    currency: 'USD',
    basis: 'net',
  });
  workOrder.create.mockResolvedValue({ id: 'wo-2' });
  workOrder.update.mockResolvedValue(undefined);
  workOrder.setValue.mockResolvedValue(undefined);
  workOrder.transition.mockResolvedValue(undefined);
});

describe('reads', () => {
  it('lists a project’s work orders, org-scoped by the query key', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useProjectWorkOrders('p1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workOrder.list).toHaveBeenCalledWith('p1');
    expect(client.getQueryData(['work-orders', 'org-1', 'p1'])).toEqual([{ id: 'wo-1' }]);
  });

  it('reads the drawdown under its own org-scoped key', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useProjectDrawdown('p1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workOrder.drawdown).toHaveBeenCalledWith('p1');
    expect(client.getQueryData(['project-drawdown', 'org-1', 'p1'])).toMatchObject({ basis: 'net' });
  });
});

describe('every write refreshes the list AND the drawdown', () => {
  const cases: Array<[string, (m: ReturnType<typeof useWorkOrderMutations>) => Promise<unknown>]> = [
    ['create', (m) => m.create.mutateAsync({ input: { title: 'x' } as never })],
    ['update', (m) => m.update.mutateAsync({ id: 'wo-1', patch: { title: 'x' } as never })],
    [
      'setValue',
      (m) => m.setValue.mutateAsync({ id: 'wo-1', value: 1, taxTreatment: 'exclusive', taxAmount: 0 }),
    ],
    ['transition', (m) => m.transition.mutateAsync({ id: 'wo-1', to: 'Cancelled' })],
  ];

  for (const [name, run] of cases) {
    it(`${name} invalidates both reads`, async () => {
      const client = freshClient();
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const { result } = renderHook(() => useWorkOrderMutations('p1'), { wrapper: wrap(client) });
      await act(async () => {
        await run(result.current);
      });
      const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['work-orders', 'org-1', 'p1']));
      expect(keys).toContain(JSON.stringify(['project-drawdown', 'org-1', 'p1']));
    });
  }
});

describe('the over-commit acknowledgement is omitted, never defaulted', () => {
  it('sends NO options object when the caller made no acknowledgement', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useWorkOrderMutations('p1'), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.transition.mutateAsync({ id: 'wo-1', to: 'Cancelled' });
    });
    expect(workOrder.transition).toHaveBeenCalledWith('wo-1', 'Cancelled', undefined);
  });

  it('passes the acknowledgement through when there IS one', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useWorkOrderMutations('p1'), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.transition.mutateAsync({
        id: 'wo-1',
        to: 'Issued',
        overCommitAck: true,
      });
    });
    expect(workOrder.transition).toHaveBeenCalledWith('wo-1', 'Issued', { overCommitAck: true });
  });
});
