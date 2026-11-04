import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * #1514 T7.1 (cache half) — the time-and-materials hooks.
 *
 * Keys carry the org id (tenant scope) and the args they were fetched with, so one project's rate card can never be
 * served for another. Every write refreshes EVERY T&M read AND `project-finances`: a rate, an assignment, an assembly,
 * a deselect or a sign-off moves what a project's money says, and the T&M screen sits beside the finances panel.
 */
const { tm } = vi.hoisted(() => ({
  tm: {
    listRateLines: vi.fn(), listRateAssignees: vi.fn(), saveContractRateLine: vi.fn(), endContractRateLine: vi.fn(),
    setContractRateAssignee: vi.fn(), endContractRateAssignee: vi.fn(), assembleTmClaim: vi.fn(), deselectTmSource: vi.fn(),
    prepareTmSignoff: vi.fn(), withdrawTmSignoff: vi.fn(), confirmTmSignoff: vi.fn(), listTmClaims: vi.fn(),
    previewTmClaim: vi.fn(), listTmClaimSources: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { timeAndMaterials: tm } }));
let org: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: org } }) }));

import {
  TM_QUERY_ROOTS, useTmRateLines, useTmRateAssignees, useTmClaims, useTmClaimPreview, useTmClaimSources,
  useSaveTmRateLine, useEndTmRateLine, useSetTmRateAssignee, useEndTmRateAssignee, useAssembleTmClaim,
  useDeselectTmSource, usePrepareTmSignoff, useWithdrawTmSignoff, useConfirmTmSignoff,
} from './useTimeAndMaterials';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const emptyPage = { rows: [], truncated: false };

beforeEach(() => {
  org = 'org-1';
  for (const fn of Object.values(tm)) fn.mockReset().mockResolvedValue(emptyPage);
});

describe('#1514 T7.1 time-and-materials hooks', () => {
  it('T7.1 every query key carries the org id and the args it was fetched with', async () => {
    const client = fresh();
    renderHook(() => {
      useTmRateLines('p1');
      useTmRateAssignees('p1');
      useTmClaims('p1');
      useTmClaimPreview({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' });
      useTmClaimSources('c1');
    }, { wrapper: wrap(client) });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    for (const orgSegment of keys.map((k) => k[1])) expect(orgSegment).toBe('org-1');
    expect(keys.map((k) => k[0]).sort()).toEqual([
      'tm-claim-preview', 'tm-claim-sources', 'tm-claims', 'tm-rate-assignees', 'tm-rate-lines',
    ]);
    for (const key of keys) expect(TM_QUERY_ROOTS).toContain(key[0]);
    // the project (or claim) is part of the key, so two projects never share a cache entry
    for (const key of keys) expect(key).toContain(key[0] === 'tm-claim-sources' ? 'c1' : 'p1');
  });

  it('T7.1 nothing is fetched without an org id, a project, or a valid range', async () => {
    org = undefined;
    renderHook(() => {
      useTmRateLines('p1');
      useTmClaims('p1');
      useTmRateAssignees('p1');
      useTmClaimSources('c1');
    }, { wrapper: wrap(fresh()) });
    org = 'org-1';
    renderHook(() => {
      useTmRateLines('');
      useTmClaims('');
      useTmClaimPreview({ projectId: 'p1', from: '', to: '' });
      useTmClaimPreview({ projectId: 'p1', from: '2026-09-30', to: '2026-09-01' });
      useTmClaimSources('');
    }, { wrapper: wrap(fresh()) });
    await new Promise((r) => setTimeout(r, 20));
    for (const fn of Object.values(tm)) expect(fn).not.toHaveBeenCalled();
  });

  it('T7.1 confirming a sign-off invalidates the claims, project finances, and existing billing flow', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmTmSignoff(), { wrapper: wrap(client) });
    await act(async () => { await result.current.mutateAsync('c1'); });
    expect(tm.confirmTmSignoff).toHaveBeenCalledWith('c1');
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['tm-claims']));
    expect(keys).toContain(JSON.stringify(['project-finances']));
    expect(keys).toContain(JSON.stringify(['progress-claims']));
  });

  it('T7.1 every write invalidates every T&M root plus project finances', async () => {
    const roots = [...TM_QUERY_ROOTS, 'project-finances'].map((root) => JSON.stringify([root]));
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => ({
      save: useSaveTmRateLine(), end: useEndTmRateLine(), assign: useSetTmRateAssignee(), unassign: useEndTmRateAssignee(),
      assemble: useAssembleTmClaim(), deselect: useDeselectTmSource(), prepare: usePrepareTmSignoff(),
      withdraw: useWithdrawTmSignoff(), confirm: useConfirmTmSignoff(),
    }), { wrapper: wrap(client) });
    const runs: Array<() => Promise<unknown>> = [
      () => result.current.save.mutateAsync({
        project_id: 'p1', kind: 'labour', label: 'Site engineer', unit: 'hour', rate: 50000, currency: 'IDR',
        effective_from: '2026-09-01',
      }),
      () => result.current.end.mutateAsync({ projectId: 'p1', lineKey: 'k1', effectiveTo: '2026-12-31', expectedVersion: 1 }),
      () => result.current.assign.mutateAsync({ projectId: 'p1', lineKey: 'k1', userId: 'u1', from: '2026-09-01', to: null }),
      () => result.current.unassign.mutateAsync({ projectId: 'p1', assigneeId: 'a1', effectiveTo: '2026-12-31' }),
      () => result.current.assemble.mutateAsync({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' }),
      () => result.current.deselect.mutateAsync({ claimId: 'c1', claimSourceId: 's1' }),
      () => result.current.prepare.mutateAsync({ claimId: 'c1', documentId: 'd1', note: null }),
      () => result.current.withdraw.mutateAsync('c1'),
      () => result.current.confirm.mutateAsync('c1'),
    ];
    for (const run of runs) {
      spy.mockClear();
      await act(async () => { await run(); });
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      for (const root of roots) expect(keys).toContain(root);
    }
  });

  it('T7.1 deselecting a source hands the RPC the claim-source ROW id it matches on (not the entry id)', async () => {
    const client = fresh();
    const { result } = renderHook(() => useDeselectTmSource(), { wrapper: wrap(client) });
    // 0516 `deselect_tm_source` matches `s.id = p_source`; `tm_claim_sources.source_id` (the timesheet entry) is a
    // different id, so the argument is named for the row it is — `claimSourceId`.
    await act(async () => { await result.current.mutateAsync({ claimId: 'c1', claimSourceId: 'row-1' }); });
    expect(tm.deselectTmSource).toHaveBeenCalledWith('c1', 'row-1');
  });

  it('T7.1 a refused write leaves the cache untouched (invalidate on success only)', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    tm.confirmTmSignoff.mockRejectedValueOnce(Object.assign(new Error('separation of duties'), { code: '42501' }));
    const { result } = renderHook(() => useConfirmTmSignoff(), { wrapper: wrap(client) });
    await act(async () => { await expect(result.current.mutateAsync('c1')).rejects.toMatchObject({ code: '42501' }); });
    expect(spy).not.toHaveBeenCalled();
  });
});
