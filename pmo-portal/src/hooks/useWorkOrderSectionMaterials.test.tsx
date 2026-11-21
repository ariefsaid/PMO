import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  liveSections: vi.fn(), linePlans: vi.fn(), allocations: vi.fn(), check: vi.fn(), setAllocation: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/workOrderSectionMaterials', () => ({
  workOrderSectionMaterialRepository: h,
}));
import {
  useLiveSections, useSectionAllocations, useSectionLinePlans, useSectionMaterialCheck, useSetAllocation,
} from './useWorkOrderSectionMaterials';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]); });

it('live sections, allocations and the material check wait for the work order', async () => {
  const idle = renderHook(() => useLiveSections(undefined), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.liveSections.mockResolvedValue([{ id: 's1', code: 'A', name: 'Earth' }]);
  const { result } = renderHook(() => useLiveSections('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual([{ id: 's1', code: 'A', name: 'Earth' }]));
  expect(h.liveSections).toHaveBeenCalledWith('wo1');

  h.allocations.mockResolvedValue([{ id: 'a1' }]);
  const alloc = renderHook(() => useSectionAllocations('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(alloc.result.current.data).toEqual([{ id: 'a1' }]));
  h.check.mockResolvedValue([]);
  const check = renderHook(() => useSectionMaterialCheck('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(check.result.current.isSuccess).toBe(true));
  expect(h.check).toHaveBeenCalledWith('wo1');
});

it('the line plans sort the items into the request key and skip the read with no items', async () => {
  const idle = renderHook(() => useSectionLinePlans('wo1', 's1', []), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  expect(h.linePlans).not.toHaveBeenCalled();

  h.linePlans.mockResolvedValue([{ itemId: 'i1', sectionPlanQty: 5, sectionPriorQty: null }]);
  const { result } = renderHook(() => useSectionLinePlans('wo1', 's1', ['i2', 'i1']), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(h.linePlans).toHaveBeenCalledWith('wo1', 's1', ['i1', 'i2'], undefined);
});

it('the exclusion id only travels when re-submitting over an existing request', async () => {
  h.linePlans.mockResolvedValue([]);
  const a = renderHook(() => useSectionLinePlans('wo1', 's1', ['i1'], 'req9'), { wrapper: wrapper() });
  await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
  expect(h.linePlans).toHaveBeenLastCalledWith('wo1', 's1', ['i1'], 'req9');
  const b = renderHook(() => useSectionLinePlans('wo1', 's1', ['i1'], null), { wrapper: wrapper() });
  await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
  expect(h.linePlans).toHaveBeenLastCalledWith('wo1', 's1', ['i1'], null);
});

it('setting an allocation forwards the four keys verbatim', async () => {
  h.setAllocation.mockResolvedValue(undefined);
  const { result } = renderHook(() => useSetAllocation('wo1'), { wrapper: wrapper() });
  await act(async () => { await result.current.mutateAsync({ sectionId: 's1', itemId: 'i1', quantity: '3' }); });
  expect(h.setAllocation).toHaveBeenCalledWith('wo1', 's1', 'i1', '3');
});
