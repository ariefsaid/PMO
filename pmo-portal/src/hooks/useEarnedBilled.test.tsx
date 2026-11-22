import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  workOrders: vi.fn(), packEarned: vi.fn(), projectPlanVsActual: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/earnedBilled', () => ({ earnedBilledRepository: { workOrders: h.workOrders, packEarned: h.packEarned } }));
vi.mock('@/src/lib/repositories/workOrderFinance', () => ({ workOrderFinanceRepository: { projectPlanVsActual: h.projectPlanVsActual } }));
import { usePackEarned, usePackRollups, useWorkOrderEarnedBilled } from './useEarnedBilled';

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

it('the pack margin reads the SAME plan-vs-actual query as the project tab, one per project', async () => {
  h.projectPlanVsActual.mockResolvedValue({ earned: 1 });
  const { result } = renderHook(() => usePackRollups(['p1', 'p2'], true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true));
  expect(h.projectPlanVsActual).toHaveBeenCalledTimes(2);
  expect(h.projectPlanVsActual).toHaveBeenCalledWith('p1');
  expect(h.projectPlanVsActual).toHaveBeenCalledWith('p2');
  const off = renderHook(() => usePackRollups(['p1'], false), { wrapper: wrapper() });
  expect(off.result.current[0]?.fetchStatus).toBe('idle');
});
