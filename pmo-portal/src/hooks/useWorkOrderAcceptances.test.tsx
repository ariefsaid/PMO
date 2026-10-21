import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  listByProject: vi.fn(async () => [{ id: 'a1', lines: [] }]),
  listLines: vi.fn(async () => [{ id: 'l1' }]),
  createLine: vi.fn(async () => ({ id: 'l1' })),
  updateLine: vi.fn(async () => undefined),
  deleteLine: vi.fn(async () => undefined),
  prepare: vi.fn(async () => 'acc-1'),
  withdraw: vi.fn(async () => undefined),
  confirm: vi.fn(async () => ({ closingValue: 1, dpHeld: 0 })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrderAcceptance: h } }));
const auth = vi.hoisted(() => ({ orgId: 'org-1' as string | undefined }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.orgId ? { id: 'u-1', org_id: auth.orgId } : null }) }));

import { useWorkOrderAcceptances, useWorkOrderAcceptanceMutations, useWorkOrderLines } from './useWorkOrderAcceptances';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, spy, wrapper };
}
const keys = (spy: ReturnType<typeof setup>['spy']) => spy.mock.calls.map(([filter]) => (filter as { queryKey: unknown[] }).queryKey);

beforeEach(() => { vi.clearAllMocks(); auth.orgId = 'org-1'; });

describe('contract-quantity read hooks', () => {
  it('AC-CQ-015 acceptances are one project query under an org-scoped key', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useWorkOrderAcceptances('p1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listByProject).toHaveBeenCalledWith('p1');
    expect(client.getQueryData(['work-order-acceptances', 'org-1', 'p1'])).toEqual([{ id: 'a1', lines: [] }]);
  });

  it('AC-CQ-015 allocations are keyed by org and work order', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useWorkOrderLines('wo-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['work-order-lines', 'org-1', 'wo-1'])).toEqual([{ id: 'l1' }]);
  });

  it('AC-CQ-015 nothing is fetched without an org or an id', () => {
    auth.orgId = undefined;
    const { wrapper } = setup();
    renderHook(() => useWorkOrderAcceptances('p1'), { wrapper });
    renderHook(() => useWorkOrderLines('wo-1'), { wrapper });
    expect(h.listByProject).not.toHaveBeenCalled();
    expect(h.listLines).not.toHaveBeenCalled();
  });
});

describe('useWorkOrderAcceptanceMutations (cache design, ADR-0090)', () => {
  it('AC-CQ-015 allocation writes refresh the allocation lists and the billing facts, nothing money-moving', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useWorkOrderAcceptanceMutations('p1'), { wrapper });
    await act(async () => { await result.current.createLine.mutateAsync({ workOrderId: 'wo-1', boqItemId: 'b1', quantity: 1000 }); });
    expect(h.createLine).toHaveBeenCalledWith({ workOrderId: 'wo-1', boqItemId: 'b1', quantity: 1000 });
    expect(keys(spy)).toEqual(expect.arrayContaining([['work-order-lines', 'org-1'], ['project-billing', 'org-1', 'p1']]));
    expect(keys(spy)).not.toContainEqual(['work-orders', 'org-1', 'p1']);
    spy.mockClear();
    await act(async () => { await result.current.updateLine.mutateAsync({ id: 'l1', quantity: 997 }); });
    expect(h.updateLine).toHaveBeenCalledWith('l1', 997);
    expect(keys(spy)).toEqual(expect.arrayContaining([['work-order-lines', 'org-1'], ['project-billing', 'org-1', 'p1']]));
    spy.mockClear();
    await act(async () => { await result.current.deleteLine.mutateAsync('l1'); });
    expect(h.deleteLine).toHaveBeenCalledWith('l1');
    expect(keys(spy)).toEqual(expect.arrayContaining([['work-order-lines', 'org-1'], ['project-billing', 'org-1', 'p1']]));
  });

  it('AC-CQ-015 preparing and withdrawing refresh only the acceptances', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useWorkOrderAcceptanceMutations('p1'), { wrapper });
    let id = '';
    await act(async () => {
      id = await result.current.prepare.mutateAsync({ workOrderId: 'wo-1', acceptanceDate: '2026-10-20', isFinal: false, lines: [], documentId: null, note: null });
    });
    expect(id).toBe('acc-1');
    expect(keys(spy)).toEqual([['work-order-acceptances', 'org-1', 'p1']]);
    spy.mockClear();
    await act(async () => { await result.current.withdraw.mutateAsync('acc-1'); });
    expect(h.withdraw).toHaveBeenCalledWith('acc-1');
    expect(keys(spy)).toEqual([['work-order-acceptances', 'org-1', 'p1']]);
  });

  it('AC-CQ-008 confirming refreshes acceptances, billing, work orders, drawdown, order billing and still-to-invoice', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useWorkOrderAcceptanceMutations('p1'), { wrapper });
    let response: unknown;
    await act(async () => { response = await result.current.confirm.mutateAsync('acc-1'); });
    expect(response).toEqual({ closingValue: 1, dpHeld: 0 });
    expect(keys(spy)).toEqual(expect.arrayContaining([
      ['work-order-acceptances', 'org-1', 'p1'], ['project-billing', 'org-1', 'p1'], ['work-orders', 'org-1', 'p1'],
      ['project-drawdown', 'org-1', 'p1'], ['work-order-billing', 'org-1', 'p1'], ['unbilled-work-orders', 'org-1'],
    ]));
  });

  it('AC-CQ-008 a refused confirmation invalidates nothing and writes no cache optimistically', async () => {
    h.confirm.mockRejectedValueOnce(new Error('closing above order net'));
    const { client, spy, wrapper } = setup();
    client.setQueryData(['work-orders', 'org-1', 'p1'], [{ id: 'wo-1', status: 'Issued' }]);
    const { result } = renderHook(() => useWorkOrderAcceptanceMutations('p1'), { wrapper });
    await act(async () => { await expect(result.current.confirm.mutateAsync('acc-1')).rejects.toThrow('closing above order net'); });
    expect(spy).not.toHaveBeenCalled();
    expect(client.getQueryData(['work-orders', 'org-1', 'p1'])).toEqual([{ id: 'wo-1', status: 'Issued' }]);
  });
});
