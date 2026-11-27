import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  workOrders: vi.fn(), packEarned: vi.fn(), projectPlanVsActual: vi.fn(), projectsPlanVsActual: vi.fn(), setPlan: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/earnedBilled', () => ({ earnedBilledRepository: { workOrders: h.workOrders, packEarned: h.packEarned } }));
vi.mock('@/src/lib/repositories/workOrderFinance', () => ({ workOrderFinanceRepository: { projectPlanVsActual: h.projectPlanVsActual, projectsPlanVsActual: h.projectsPlanVsActual, setPlan: h.setPlan } }));
import { useSaveWorkOrderPlan } from './useWorkOrderPlanVsActual';
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

it.each([2, 200])('AC-Q9-001: reads %i project margins with one repository request', async (count) => {
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  const fixture = Object.fromEntries(ids.map((id) => [id, { earned: 1 }]));
  h.projectsPlanVsActual.mockResolvedValue(fixture);
  h.projectPlanVsActual.mockResolvedValue({ earned: 1 });
  const { result } = renderHook(() => usePackRollups(ids, true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true));
  expect(h.projectPlanVsActual).not.toHaveBeenCalled();
  expect(h.projectsPlanVsActual).toHaveBeenCalledExactlyOnceWith(ids);
  expect(result.current.map((r) => r.data)).toEqual(ids.map((id) => fixture[id]));
  const off = renderHook(() => usePackRollups(['p1'], false), { wrapper: wrapper() });
  expect(off.result.current[0]?.fetchStatus).toBe('idle');
  expect(h.projectsPlanVsActual).toHaveBeenCalledTimes(1);
});

it('AC-Q9-012: one shared request error retries all projects together', async () => {
  h.projectsPlanVsActual.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ p1: { earned: 1 }, p2: { earned: 2 } });
  const { result } = renderHook(() => usePackRollups(['p1','p2'], true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.every((r) => r.isBatchError)).toBe(true));
  await result.current[0].refetch();
  await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true));
  expect(h.projectsPlanVsActual).toHaveBeenCalledTimes(2);
});

it('AC-Q9-019: saving a project plan refreshes the batched pack', async () => {
  h.projectsPlanVsActual.mockResolvedValue({ p1: { earned: 1 } });
  const { result } = renderHook(() => ({ pack: usePackRollups(['p1'], true), save: useSaveWorkOrderPlan('p1') }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.pack[0].isSuccess).toBe(true));
  await act(async () => { await result.current.save.mutateAsync({ workOrderId: 'wo1', changes: [] }); });
  expect(h.projectsPlanVsActual).toHaveBeenCalledTimes(2);
});
