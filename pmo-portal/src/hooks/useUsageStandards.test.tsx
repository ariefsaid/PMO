import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  list: vi.fn(), matchCounts: vi.fn(), create: vi.fn(), update: vi.fn(), setArchived: vi.fn(),
  plan: vi.fn(), planInputs: vi.fn(), generate: vi.fn(), adjust: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/usageStandards', () => ({ usageStandardRepository: h }));
import {
  USAGE_STANDARD_QUERY_ROOT, useConsumablePlan, useConsumablePlanMutations, usePlanInputs,
  useStandardMatchCounts, useUsageStandardMutations, useUsageStandards,
} from './useUsageStandards';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]); });

it('the list, match counts, plan and plan inputs read through the repository and wait for their keys', async () => {
  const filter = { itemCode: 'C' } as never;
  h.list.mockResolvedValue([{ id: 'u1' }]);
  const list = renderHook(() => useUsageStandards(filter), { wrapper: wrapper() });
  await waitFor(() => expect(list.result.current.data).toEqual([{ id: 'u1' }]));
  expect(h.list).toHaveBeenCalledWith(filter);
  h.matchCounts.mockResolvedValue({ 'C-1': 3 });
  const counts = renderHook(() => useStandardMatchCounts(), { wrapper: wrapper() });
  await waitFor(() => expect(counts.result.current.data).toEqual({ 'C-1': 3 }));

  const idle = renderHook(() => useConsumablePlan(undefined), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.plan.mockResolvedValue({ items: [] });
  const plan = renderHook(() => useConsumablePlan('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(plan.result.current.isSuccess).toBe(true));
  expect(h.plan).toHaveBeenCalledWith('wo1');

  const off = renderHook(() => usePlanInputs('wo1', false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');
  h.planInputs.mockResolvedValue([]);
  const inputs = renderHook(() => usePlanInputs('wo1', true), { wrapper: wrapper() });
  await waitFor(() => expect(inputs.result.current.isSuccess).toBe(true));
  expect(h.planInputs).toHaveBeenCalledWith('wo1');
});

it('standard writes forward their payloads and invalidate the family', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useUsageStandardMutations(), { wrapper: w });
  const input = { itemCode: 'C', quantity: 1, unit: 'bag' } as never;
  h.create.mockResolvedValue('u1');
  await act(async () => { await result.current.create.mutateAsync(input); });
  expect(h.create).toHaveBeenCalledWith(input);
  h.update.mockResolvedValue(undefined);
  await act(async () => { await result.current.update.mutateAsync({ id: 'u1', input }); });
  expect(h.update).toHaveBeenCalledWith('u1', input);
  h.setArchived.mockResolvedValue(undefined);
  await act(async () => { await result.current.archive.mutateAsync({ id: 'u1', archived: true }); });
  expect(h.setArchived).toHaveBeenCalledWith('u1', true);
  expect(spy).toHaveBeenCalledWith({ queryKey: [USAGE_STANDARD_QUERY_ROOT, 'org-1'] });
});

it('a plan change refreshes the request-form plan reads beside the standards family', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useConsumablePlanMutations('wo1'), { wrapper: w });
  h.generate.mockResolvedValue(undefined);
  await act(async () => { await result.current.generate.mutateAsync(); });
  expect(h.generate).toHaveBeenCalledWith('wo1');
  h.adjust.mockResolvedValue(undefined);
  await act(async () => { await result.current.adjust.mutateAsync({ itemId: 'i1', adjustedQty: '2', reason: null }); });
  expect(h.adjust).toHaveBeenCalledWith({ workOrderId: 'wo1', itemId: 'i1', adjustedQty: '2', reason: null });
  const roots = spy.mock.calls.map(([a]) => (a as { queryKey: readonly unknown[] }).queryKey[0]);
  expect(roots).toContain(USAGE_STANDARD_QUERY_ROOT);
});
