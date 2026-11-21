import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), overContract: vi.fn(), workOrderBudget: vi.fn(), approvalState: vi.fn(), versions: vi.fn(), limit: vi.fn(), raise: vi.fn(), updateDraft: vi.fn(), submit: vi.fn(), approve: vi.fn(),
  returnRequest: vi.fn(), withdraw: vi.fn(), recordSent: vi.fn(), recordDecision: vi.fn(),
  recordForecast: vi.fn(), setLimit: vi.fn(), uploadFile: vi.fn(), archiveFile: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { quantityChange: h } }));
import { qcrKeys, useOverContract, useQuantityChangeApproval, useQuantityChangeMutations, useQuantityChangeRequest, useQuantityChangeRequests, useQuantityVersions, useWorkOrderRequestBudget } from './useQuantityChanges';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]); });

it('the list carries the filter and page in its key and resolves through the repository', async () => {
  h.list.mockResolvedValue({ rows: [{ id: 'q1' }], hasMore: false });
  const { result } = renderHook(() => useQuantityChangeRequests({ projectId: 'p1', status: 'sent_to_client' as never }, 2), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual({ rows: [{ id: 'q1' }], hasMore: false }));
  expect(h.list).toHaveBeenCalledWith({ projectId: 'p1', status: 'sent_to_client' }, 2);
  expect(qcrKeys.list('org-1', { projectId: 'p1', status: 'sent_to_client' }, 2)).toContain(2);
});

it('detail, budget, approval and versions all wait for their ids', async () => {
  const idle = renderHook(() => useQuantityChangeRequest(undefined), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.get.mockResolvedValue({ request: { id: 'q1' } });
  const detail = renderHook(() => useQuantityChangeRequest('q1'), { wrapper: wrapper() });
  await waitFor(() => expect(detail.result.current.data).toEqual({ request: { id: 'q1' } }));
  expect(h.get).toHaveBeenCalledWith('q1');

  h.workOrderBudget.mockResolvedValue({ request_count: 2, request_limit: 5 });
  const budget = renderHook(() => useWorkOrderRequestBudget('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(budget.result.current.data).toEqual({ request_count: 2, request_limit: 5 }));
  expect(h.workOrderBudget).toHaveBeenCalledWith('wo1');

  const idleApproval = renderHook(() => useQuantityChangeApproval(undefined, true), { wrapper: wrapper() });
  expect(idleApproval.result.current.fetchStatus).toBe('idle');
  h.approvalState.mockResolvedValue({ can_approve: true, reason: null, eligible_approver_exists: true });
  const approval = renderHook(() => useQuantityChangeApproval('q1', true), { wrapper: wrapper() });
  await waitFor(() => expect(approval.result.current.data).toMatchObject({ can_approve: true }));
  expect(h.approvalState).toHaveBeenCalledWith('q1');

  const idleVersions = renderHook(() => useQuantityVersions(undefined), { wrapper: wrapper() });
  expect(idleVersions.result.current.fetchStatus).toBe('idle');
  h.versions.mockResolvedValue([{ version_no: 1, quantity: 7 }]);
  const versions = renderHook(() => useQuantityVersions('b1'), { wrapper: wrapper() });
  await waitFor(() => expect(versions.result.current.data).toEqual([{ version_no: 1, quantity: 7 }]));
  expect(h.versions).toHaveBeenCalledWith('b1');
});

it('over-contract respects the only-over flag and its own enabled switch', async () => {
  const off = renderHook(() => useOverContract('p1', true, false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');
  expect(h.overContract).not.toHaveBeenCalled();
  h.overContract.mockResolvedValue([{ boq_item_id: 'b1', over_progress: true }]);
  const { result } = renderHook(() => useOverContract('p1', true, true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual([{ boq_item_id: 'b1', over_progress: true }]));
  expect(h.overContract).toHaveBeenCalledWith('p1', true);
});

it('the state transitions forward their payloads; the limit write keys on the caller org', async () => {
  const { result } = renderHook(() => useQuantityChangeMutations(), { wrapper: wrapper() });
  h.raise.mockResolvedValue('q1');
  const input = { workOrderId: 'wo1', clientRequestId: 'c1', lines: [{ boqItemId: 'b1', requestedQuantity: '3', reason: 'r' }] };
  await act(async () => { await result.current.raise.mutateAsync(input); });
  expect(h.raise).toHaveBeenCalledWith(input);
  h.updateDraft.mockResolvedValue(undefined);
  await act(async () => { await result.current.updateDraft.mutateAsync({ id: 'q1', lines: null, note: 'n' }); });
  expect(h.updateDraft).toHaveBeenCalledWith('q1', null, 'n');
  h.submit.mockResolvedValue(undefined);
  h.approve.mockResolvedValue(undefined);
  await act(async () => { await result.current.submit.mutateAsync('q1'); });
  expect(h.submit).toHaveBeenCalledWith('q1');
  await act(async () => { await result.current.approve.mutateAsync('q1'); });
  expect(h.approve).toHaveBeenCalledWith('q1');
  h.returnRequest.mockResolvedValue(undefined);
  await act(async () => { await result.current.returnRequest.mutateAsync({ id: 'q1', reason: 'measured twice' }); });
  expect(h.returnRequest).toHaveBeenCalledWith('q1', 'measured twice');
  h.withdraw.mockResolvedValue(undefined);
  await act(async () => { await result.current.withdraw.mutateAsync({ id: 'q1', reason: 'gone' }); });
  expect(h.withdraw).toHaveBeenCalledWith('q1', 'gone');
  h.recordSent.mockResolvedValue(undefined);
  await act(async () => { await result.current.recordSent.mutateAsync({ id: 'q1', sentDate: '2026-03-10', clientReference: 'REF' }); });
  expect(h.recordSent).toHaveBeenCalledWith('q1', '2026-03-10', 'REF');
  h.recordDecision.mockResolvedValue(undefined);
  await act(async () => { await result.current.recordDecision.mutateAsync({ id: 'q1', decision: 'accepted', decisionDate: '2026-03-12', note: null }); });
  expect(h.recordDecision).toHaveBeenCalledWith('q1', 'accepted', '2026-03-12', null);
  h.recordForecast.mockResolvedValue('v1');
  await act(async () => { await result.current.recordForecast.mutateAsync({ boqItemId: 'b1', quantity: '9', note: null }); });
  expect(h.recordForecast).toHaveBeenCalledWith('b1', '9', null);
  h.setLimit.mockResolvedValue(undefined);
  await act(async () => { await result.current.setLimit.mutateAsync(12); });
  expect(h.setLimit).toHaveBeenCalledWith('org-1', 12);
  h.uploadFile.mockResolvedValue(undefined);
  const file = new File(['x'], 'a.pdf');
  await act(async () => { await result.current.uploadFile.mutateAsync({ request: { id: 'q1', org_id: 'o1' } as never, kind: 'supporting', file }); });
  expect(h.uploadFile).toHaveBeenCalledWith({ id: 'q1', org_id: 'o1' }, 'supporting', file);
  h.archiveFile.mockResolvedValue(undefined);
  await act(async () => { await result.current.archiveFile.mutateAsync('f1'); });
  expect(h.archiveFile).toHaveBeenCalledWith('f1');
});
