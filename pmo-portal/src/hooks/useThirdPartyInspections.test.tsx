import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listForWorkOrder: vi.fn(), costs: vi.fn(), listFiles: vi.fn(),
  create: vi.fn(), raisePurchase: vi.fn(), recordInvitation: vi.fn(), recordExecution: vi.fn(),
  recordReport: vi.fn(), waive: vi.fn(), cancel: vi.fn(), addFile: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { thirdPartyInspection: h } }));
import {
  useInspectionCosts, useInspectionFiles, useInspectionMutations, useWorkOrderInspections,
} from './useThirdPartyInspections';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]); });

it('the work order list, costs and files read through the repository and wait for their ids', async () => {
  const idle = renderHook(() => useWorkOrderInspections(null), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.listForWorkOrder.mockResolvedValue([{ id: 'i1' }]);
  const list = renderHook(() => useWorkOrderInspections('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(list.result.current.data).toEqual([{ id: 'i1' }]));
  expect(h.listForWorkOrder).toHaveBeenCalledWith('wo1');

  h.costs.mockResolvedValue([]);
  const costs = renderHook(() => useInspectionCosts('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(costs.result.current.isSuccess).toBe(true));
  expect(h.costs).toHaveBeenCalledWith('wo1');

  const idleFiles = renderHook(() => useInspectionFiles(undefined), { wrapper: wrapper() });
  expect(idleFiles.result.current.fetchStatus).toBe('idle');
  h.listFiles.mockResolvedValue([{ id: 'f1' }]);
  const files = renderHook(() => useInspectionFiles('i1'), { wrapper: wrapper() });
  await waitFor(() => expect(files.result.current.data).toEqual([{ id: 'f1' }]));
  expect(h.listFiles).toHaveBeenCalledWith('i1');
});

it('the state machine mutations forward their payloads', async () => {
  const { result } = renderHook(() => useInspectionMutations('wo1'), { wrapper: wrapper() });
  h.create.mockResolvedValue('i1');
  await act(async () => { await result.current.create.mutateAsync({ workOrderId: 'wo1', title: 'RT', testKind: 'rt', plannedDate: '2026-03-10', vendorId: null, estimate: null, estimateCurrency: null, note: null, requiredFor: [] }); });
  expect(h.create).toHaveBeenCalledWith({ workOrderId: 'wo1', title: 'RT', testKind: 'rt', plannedDate: '2026-03-10', vendorId: null, estimate: null, estimateCurrency: null, note: null, requiredFor: [] });
  await act(async () => { await result.current.raisePurchase.mutateAsync({ id: 'i1', procurementId: 'po1' }); });
  expect(h.raisePurchase).toHaveBeenCalledWith('i1', 'po1');
  await act(async () => { await result.current.invite.mutateAsync({ id: 'i1', on: '2026-03-01', who: 'Dewi', how: 'email' }); });
  expect(h.recordInvitation).toHaveBeenCalledWith('i1', '2026-03-01', 'Dewi', 'email');
  await act(async () => { await result.current.execute.mutateAsync({ id: 'i1', on: '2026-03-02' }); });
  expect(h.recordExecution).toHaveBeenCalledWith('i1', '2026-03-02');
  await act(async () => { await result.current.report.mutateAsync({ id: 'i1', result: 'pass' }); });
  expect(h.recordReport).toHaveBeenCalledWith('i1', 'pass');
  await act(async () => { await result.current.waive.mutateAsync({ id: 'i1', reason: 'client' }); });
  expect(h.waive).toHaveBeenCalledWith('i1', 'client');
  await act(async () => { await result.current.cancel.mutateAsync({ id: 'i1', reason: 'scope' }); });
  expect(h.cancel).toHaveBeenCalledWith('i1', 'scope');
});

it('a report file is added with the live count, and a removed one deletes by id', async () => {
  const { result } = renderHook(() => useInspectionMutations('wo1'), { wrapper: wrapper() });
  const file = new File(['x'], 'r.pdf', { type: 'application/pdf' });
  const inspection = { id: 'i1', org_id: 'o1' } as never;
  h.addFile.mockResolvedValue({ id: 'f1' });
  await act(async () => { await result.current.addFile.mutateAsync({ inspection, file, liveCount: 2 }); });
  expect(h.addFile).toHaveBeenCalledWith(inspection, file, 2);
});
