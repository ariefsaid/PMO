import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  workOrders: vi.fn(), packEarned: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/earnedBilled', () => ({ earnedBilledRepository: { workOrders: h.workOrders, packEarned: h.packEarned } }));
import { usePackEarned, useWorkOrderEarnedBilled } from './useEarnedBilled';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]); });

it('the work order earned/billed read waits for the feature flag and the project', async () => {
  const off = renderHook(() => useWorkOrderEarnedBilled('p1', false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');
  expect(h.workOrders).not.toHaveBeenCalled();
  h.workOrders.mockResolvedValue([{ work_order_id: 'wo1', earned: 100 }]);
  const { result } = renderHook(() => useWorkOrderEarnedBilled('p1', true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual([{ work_order_id: 'wo1', earned: 100 }]));
  expect(h.workOrders).toHaveBeenCalledWith('p1');
});

it('the pack earned read is org-scoped and gated on the flag', async () => {
  const off = renderHook(() => usePackEarned(false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');
  h.packEarned.mockResolvedValue([{ project_id: 'p1', earned: 5 }]);
  const { result } = renderHook(() => usePackEarned(true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual([{ project_id: 'p1', earned: 5 }]));
  expect(h.packEarned).toHaveBeenCalledOnce();
});

it('the pack loads the project margin inputs together in its own query', async () => {
  const rows = [{ projectId: 'p1', cost: '1.00' }, { projectId: 'p2', cost: '2.00' }];
  h.packEarned.mockResolvedValue(rows);
  const { result } = renderHook(() => usePackEarned(true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual(rows));
  expect(h.packEarned).toHaveBeenCalledOnce();
});
