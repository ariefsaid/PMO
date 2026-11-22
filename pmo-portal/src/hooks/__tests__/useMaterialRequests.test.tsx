import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** Material request hooks (#2524): reads wait for a signed-in org, writes call the repository and refresh the lists. */
const h = vi.hoisted(() => ({
  user: { value: { org_id: 'org1' } as { org_id: string } | null },
  repo: {
    list: vi.fn(), get: vi.fn(), waitingForMe: vi.fn(), linePlans: vi.fn(), chain: vi.fn(), cutoff: vi.fn(), standIns: vi.fn(),
    saveDraft: vi.fn(), submit: vi.fn(), decideStep: vi.fn(), cancel: vi.fn(), retryTransfer: vi.fn(), setChain: vi.fn(),
    setCutoff: vi.fn(), setStandIn: vi.fn(), revokeStandIn: vi.fn(),
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.user.value }) }));
vi.mock('@/src/lib/repositories/materialRequests', () => ({ materialRequestRepository: h.repo }));

import {
  useMaterialRequests, useMaterialRequest, useWaitingForMe, useLinePlans, useApprovalChain, useMaterialRequestCutoff,
  useStandIns, useMaterialRequestMutations,
} from '../useMaterialRequests';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.user.value = { org_id: 'org1' };
  for (const f of Object.values(h.repo)) f.mockReset().mockResolvedValue(null);
});

describe('material request reads', () => {
  it('FR-MRQ-017 each read calls its repository once the org is known', async () => {
    const f = { workOrderId: 'wo1' };
    renderHook(() => { useMaterialRequests(f); useMaterialRequest('mr1'); useWaitingForMe(); useApprovalChain(); useMaterialRequestCutoff(); useStandIns(); }, { wrapper });
    await waitFor(() => expect(h.repo.standIns).toHaveBeenCalled());
    expect(h.repo.list).toHaveBeenCalledWith(f);
    expect(h.repo.get).toHaveBeenCalledWith('mr1');
    expect(h.repo.waitingForMe).toHaveBeenCalled();
    expect(h.repo.chain).toHaveBeenCalled();
    expect(h.repo.cutoff).toHaveBeenCalled();
  });
  it('FR-MRQ-002 plans are fetched for the sorted items only when there is a work order and at least one item', async () => {
    const { rerender } = renderHook(({ wo, items }: { wo?: string; items: string[] }) => useLinePlans(wo, items, 'mr9'), { wrapper, initialProps: { wo: undefined as string | undefined, items: ['b', 'a'] } });
    expect(h.repo.linePlans).not.toHaveBeenCalled();
    rerender({ wo: 'wo1', items: [] });
    expect(h.repo.linePlans).not.toHaveBeenCalled();
    rerender({ wo: 'wo1', items: ['b', 'a'] });
    await waitFor(() => expect(h.repo.linePlans).toHaveBeenCalledWith('wo1', ['a', 'b'], 'mr9'));
  });
  it('nothing is read before a user with an org is signed in, or without a request id', () => {
    h.user.value = null;
    renderHook(() => { useMaterialRequests({}); useWaitingForMe(); useApprovalChain(); }, { wrapper });
    h.user.value = { org_id: 'org1' };
    renderHook(() => useMaterialRequest(undefined), { wrapper });
    expect(h.repo.list).not.toHaveBeenCalled();
    expect(h.repo.waitingForMe).not.toHaveBeenCalled();
    expect(h.repo.get).not.toHaveBeenCalled();
  });
});

describe('material request writes', () => {
  it('FR-MRQ-008 each write carries its arguments to the repository and refreshes every material request list', async () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useMaterialRequestMutations(), { wrapper });
    const header = { workOrderId: 'wo1', neededBy: '2026-11-25', toWarehouseId: null, note: null };
    await act(async () => {
      await result.current.saveDraft.mutateAsync({ id: null, header, lines: [], clientRequestId: 'c1' });
      await result.current.submit.mutateAsync({ id: 'mr1', clientRequestId: 'c2' });
      await result.current.decide.mutateAsync({ id: 'mr1', position: 2, decision: 'return', reason: 'split it', sourceWarehouseId: 'wh1' });
      await result.current.cancel.mutateAsync({ id: 'mr1', reason: 'not needed' });
      await result.current.retryTransfer.mutateAsync({ id: 'mr1', sourceWarehouseId: 'wh1' });
      await result.current.setChain.mutateAsync([{ role: 'Engineer', jobRole: null, label: 'Plan check', onlyOverPlan: false }]);
      await result.current.setCutoff.mutateAsync('12:00');
      await result.current.setStandIn.mutateAsync({ delegatorId: 'u1', standInId: 'u2', startsOn: '2026-11-20', endsOn: '2026-11-27' });
      await result.current.revokeStandIn.mutateAsync('s1');
    });
    expect(h.repo.saveDraft).toHaveBeenCalledWith(null, header, [], 'c1');
    expect(h.repo.submit).toHaveBeenCalledWith('mr1', 'c2');
    expect(h.repo.decideStep).toHaveBeenCalledWith('mr1', 2, 'return', { reason: 'split it', sourceWarehouseId: 'wh1' });
    expect(h.repo.cancel).toHaveBeenCalledWith('mr1', 'not needed');
    expect(h.repo.retryTransfer).toHaveBeenCalledWith('mr1', 'wh1');
    expect(h.repo.setChain).toHaveBeenCalled();
    expect(h.repo.setCutoff).toHaveBeenCalledWith('12:00');
    expect(h.repo.setStandIn).toHaveBeenCalledWith({ delegatorId: 'u1', standInId: 'u2', startsOn: '2026-11-20', endsOn: '2026-11-27' });
    expect(h.repo.revokeStandIn).toHaveBeenCalledWith('s1');
    expect(spy).toHaveBeenCalledTimes(9);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['material-requests', 'org1'] });
  });
  it('AC-MRQ-003 a refused decision rejects and refreshes nothing', async () => {
    h.repo.decideStep.mockRejectedValue(new Error('MRQ_SOD_AUTHOR'));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useMaterialRequestMutations(), { wrapper });
    await act(async () => { await expect(result.current.decide.mutateAsync({ id: 'mr1', position: 1, decision: 'approve' })).rejects.toThrow('MRQ_SOD_AUTHOR'); });
    expect(spy).not.toHaveBeenCalled();
  });
});
