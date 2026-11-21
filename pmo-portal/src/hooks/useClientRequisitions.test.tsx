import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  forWorkOrder: vi.fn(), create: vi.fn(), updateDraft: vi.fn(), send: vi.fn(), cancel: vi.fn(),
  recordReservation: vi.fn(), recordRelease: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/clientRequisitions', () => ({
  clientRequisitionRepository: {
    forWorkOrder: h.forWorkOrder, create: h.create, updateDraft: h.updateDraft, send: h.send,
    cancel: h.cancel, recordReservation: h.recordReservation, recordRelease: h.recordRelease,
  },
}));
import { CLIENT_REQUISITION_QUERY_ROOT, useClientRequisitionMutations, useWorkOrderClientMaterial } from './useClientRequisitions';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]); });

it('the work order read waits for the work order and resolves through the repository (AC-CSR-003: empty stays empty)', async () => {
  const idle = renderHook(() => useWorkOrderClientMaterial(undefined), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  expect(h.forWorkOrder).not.toHaveBeenCalled();

  h.forWorkOrder.mockResolvedValue({ requisitions: [] });
  const { result } = renderHook(() => useWorkOrderClientMaterial('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual({ requisitions: [] }));
  expect(h.forWorkOrder).toHaveBeenCalledWith('wo1');
});

it('create and updateDraft carry the header and the lines separately onto the repository', async () => {
  h.create.mockResolvedValue('cr1');
  h.updateDraft.mockResolvedValue(undefined);
  const { result } = renderHook(() => useClientRequisitionMutations(), { wrapper: wrapper() });
  const lines = [{ itemId: 'i1', quantity: '2' }] as never;
  await act(async () => { await result.current.create.mutateAsync({ workOrderId: 'wo1', clientReference: 'REF', lines }); });
  expect(h.create).toHaveBeenCalledWith({ workOrderId: 'wo1', clientReference: 'REF' }, lines, undefined);
  await act(async () => { await result.current.updateDraft.mutateAsync({ id: 'cr1', clientReference: null, lines }); });
  expect(h.updateDraft).toHaveBeenCalledWith('cr1', { clientReference: null }, lines);
});

it('send and cancel forward the id with their optional payload', async () => {
  h.send.mockResolvedValue(undefined);
  h.cancel.mockResolvedValue(undefined);
  const { result } = renderHook(() => useClientRequisitionMutations(), { wrapper: wrapper() });
  await act(async () => { await result.current.send.mutateAsync({ id: 'cr1' }); });
  expect(h.send).toHaveBeenCalledWith('cr1', undefined);
  await act(async () => { await result.current.cancel.mutateAsync({ id: 'cr1', reason: 'wrong items' }); });
  expect(h.cancel).toHaveBeenCalledWith('cr1', 'wrong items');
});

it('a reservation records the pickup facts; a release records who released what', async () => {
  h.recordReservation.mockResolvedValue(undefined);
  h.recordRelease.mockResolvedValue(undefined);
  const { result } = renderHook(() => useClientRequisitionMutations(), { wrapper: wrapper() });
  await act(async () => {
    await result.current.recordReservation.mutateAsync({ lineId: 'l1', quantity: '4', clientReference: 'REF', reservedOn: '2026-03-10', note: 'gate' });
  });
  expect(h.recordReservation).toHaveBeenCalledWith('l1', { quantity: '4', clientReference: 'REF', reservedOn: '2026-03-10', note: 'gate' }, undefined);
  await act(async () => { await result.current.recordRelease.mutateAsync({ lineId: 'l1', reason: 'returned', quantity: '4' }); });
  expect(h.recordRelease).toHaveBeenCalled();
});

it('a successful write refreshes the requisition family AND the stock balances it moves', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  h.send.mockResolvedValue(undefined);
  const { result } = renderHook(() => useClientRequisitionMutations(), { wrapper: w });
  await act(async () => { await result.current.send.mutateAsync({ id: 'cr1' }); });
  const keys = spy.mock.calls.map(([a]) => (a as { queryKey: readonly unknown[] }).queryKey[0]);
  expect(keys).toContain(CLIENT_REQUISITION_QUERY_ROOT);
  expect(keys).toContain('wo-stock-balance');
});
