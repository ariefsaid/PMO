import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { imprest, orgSettings } = vi.hoisted(() => ({
  orgSettings: { listSpendApprovers: vi.fn() },
  imprest: {
    listFloats: vi.fn(), getFloat: vi.fn(), getPosition: vi.fn(), getPlanUsage: vi.fn(), floatChoices: vi.fn(), listPlans: vi.fn(),
    listPlanLines: vi.fn(), listReplenishments: vi.fn(), listCounts: vi.fn(), listAwaitingImprest: vi.fn(), createPlan: vi.fn(), savePlanLine: vi.fn(),
    deletePlanLine: vi.fn(), setProcurementLimit: vi.fn(), establishFloat: vi.fn(), proposeFloatAmount: vi.fn(),
    decideFloatChange: vi.fn(), transitionPlan: vi.fn(), requestReplenishment: vi.fn(), transitionReplenishment: vi.fn(),
    recordCount: vi.fn(), listPostingStates: vi.fn(), setCashAccount: vi.fn(), countFloats: vi.fn(),
    getRequesterRoute: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { imprest, orgSettings } }));
let org: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: org } }) }));

import {
  IMPREST_QUERY_ROOTS, useImprestFloats, useImprestFloatPages, useImprestPosition, useImprestPlans, useImprestReplenishments,
  useImprestCounts, useImprestFloatChoices, useImprestFloat, useRequestReplenishment, useTransitionPlan, useRecordCount, useEstablishFloat,
  useImprestPostingStates, useSetCashAccount,
  useImprestAwaiting, useImprestRequesterRoute,
} from './useImprest';
import { EXPENSE_QUERY_ROOTS } from './useExpenseClaims';
import { expenseClaimsAwaitingKey } from './approvalsQueryKeys';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  org = 'org-1';
  for (const fn of Object.values(imprest)) fn.mockReset().mockResolvedValue([]);
  imprest.getPosition.mockResolvedValue(null);
  imprest.requestReplenishment.mockResolvedValue('r1');
});

describe('AC-PAGE-024 useImprestFloatPages', () => {
  it('AC-PAGE-024 reads the numbered page asked for and carries the server total', async () => {
    imprest.listFloats.mockResolvedValue({ rows: [{ id: 'f2' }], truncated: false });
    imprest.countFloats.mockResolvedValue(120);
    const client = fresh();
    const { result, rerender } = renderHook(({ page }) => useImprestFloatPages(page), { wrapper: wrap(client), initialProps: { page: 1 } });
    await waitFor(() => expect(result.current.total).toBe(120));
    expect(imprest.listFloats).toHaveBeenLastCalledWith(1);
    rerender({ page: 3 });
    await waitFor(() => expect(imprest.listFloats).toHaveBeenLastCalledWith(3));
    expect(client.getQueryCache().getAll().every((q) => q.queryKey[0] === 'imprest-floats' && q.queryKey[1] === 'org-1')).toBe(true);
  });
});

it('site-cash awaiting exposes that its org-scoped query is enabled and loading', async () => {
  imprest.listAwaitingImprest.mockResolvedValue({ plans: [], replenishments: [] });
  const { result } = renderHook(() => useImprestAwaiting(), { wrapper: wrap(fresh()) });
  expect(result.current.enabled).toBe(true);
  expect(result.current.isPending).toBe(true);
  await waitFor(() => expect(result.current.data).toEqual({ plans: [], replenishments: [] }));
  expect(result.current.enabled).toBe(true);
});

it('site-cash awaiting is disabled without an org even while React Query reports pending', () => {
  org = undefined;
  const { result } = renderHook(() => useImprestAwaiting(), { wrapper: wrap(fresh()) });
  expect(result.current.enabled).toBe(false);
  expect(result.current.isPending).toBe(true);
  expect(imprest.listAwaitingImprest).not.toHaveBeenCalled();
});

describe('AC-IMP-083 imprest hooks', () => {
  it('AC-IMP-083 every query key carries the org id', async () => {
    const client = fresh();
    renderHook(() => {
      useImprestFloats(); useImprestPosition('f1'); useImprestPlans('f1');
      useImprestReplenishments('f1'); useImprestCounts('f1'); useImprestFloatChoices('p1', 'Vehicle'); useImprestFloat('f1'); useImprestPostingStates('f1');
    }, { wrapper: wrap(client) });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const keys = client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey)).sort();
    expect(keys).toEqual([
      ['imprest-counts', 'org-1', 'f1'], ['imprest-float-choices', 'org-1', 'p1', 'Vehicle'], ['imprest-floats', 'org-1'], ['imprest-float', 'org-1', 'f1'],
      ['imprest-plans', 'org-1', 'f1'],
      ['imprest-position', 'org-1', 'f1'], ['imprest-replenishments', 'org-1', 'f1'], ['imprest-posting-states', 'org-1', 'f1'],
    ].map((k) => JSON.stringify(k)).sort());
  });

  it('AC-IMP-083 nothing is fetched without an org id or the required ids', async () => {
    org = undefined;
    const c1 = fresh();
    renderHook(() => { useImprestFloats(); useImprestPosition('f1'); }, { wrapper: wrap(c1) });
    org = 'org-1';
    const c2 = fresh();
    renderHook(() => { useImprestPosition(undefined); useImprestFloatChoices(undefined, null); },
      { wrapper: wrap(c2) });
    await new Promise((r) => setTimeout(r, 20));
    expect(imprest.listFloats).not.toHaveBeenCalled();
    expect(imprest.getPosition).not.toHaveBeenCalled();
    expect(imprest.floatChoices).not.toHaveBeenCalled();
  });

  it('AC-IMP-083 every mutation invalidates position, plan usage, replenishments, claims and approvals', async () => {
    const roots = [...IMPREST_QUERY_ROOTS, ...EXPENSE_QUERY_ROOTS, expenseClaimsAwaitingKey('org-1')[0]];
    const calls: Array<[string, () => Promise<unknown>, () => void]> = [];
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => ({
      rep: useRequestReplenishment(), plan: useTransitionPlan(), count: useRecordCount(), establish: useEstablishFloat(), bind: useSetCashAccount(),
    }), { wrapper: wrap(client) });
    calls.push(
      ['request_imprest_replenishment', () => result.current.rep.mutateAsync({ floatId: 'f1', kind: 'funding' }), () => expect(imprest.requestReplenishment).toHaveBeenCalledWith('f1', 'funding')],
      ['transition_imprest_plan', () => result.current.plan.mutateAsync({ id: 'p1', to: 'Submitted' }), () => expect(imprest.transitionPlan).toHaveBeenCalledWith('p1', 'Submitted', undefined)],
      ['record_imprest_count', () => result.current.count.mutateAsync({ floatId: 'f1', counted: 100, note: 'n' }), () => expect(imprest.recordCount).toHaveBeenCalledWith('f1', 100, 'n')],
      ['imprest-cash-account', () => result.current.bind.mutateAsync({ floatId: 'f1', account: 'A' }), () => expect(imprest.setCashAccount).toHaveBeenCalledWith('f1', 'A')],
      ['establish_imprest_float', () => result.current.establish.mutateAsync({ projectId: 'p', custodianId: 'c', amount: 5 }), () => expect(imprest.establishFloat).toHaveBeenCalledWith('p', 'c', 5)],
    );
    for (const [, run, assertCall] of calls) {
      spy.mockClear();
      await act(async () => { await run(); });
      assertCall();
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      for (const root of roots) expect(keys).toContain(JSON.stringify([root]));
    }
  });
});

describe('#1568 requester who-next', () => {
  it('AC-IMP-083 reads one record route under the org key and stays idle without a record', async () => {
    imprest.getRequesterRoute.mockResolvedValue({ route_kind: 'named', approvers: [], action: 'approve', admin_breakglass: false });
    const client = fresh();
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useImprestRequesterRoute('plan', id),
      { wrapper: wrap(client), initialProps: { id: 'pl1' } },
    );
    await waitFor(() => expect(result.current.data?.route_kind).toBe('named'));
    expect(imprest.getRequesterRoute).toHaveBeenCalledWith('plan', 'pl1');
    expect(client.getQueryCache().getAll().every((q) => q.queryKey[0] === 'imprest-requester-route' && q.queryKey[1] === 'org-1')).toBe(true);
    rerender({ id: null });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(imprest.getRequesterRoute).toHaveBeenCalledTimes(1);
  });

  it('binds the expected action into the key so the approval answer cannot serve the pay slot', async () => {
    imprest.getRequesterRoute
      .mockResolvedValueOnce({ route_kind: 'finance_admin', approvers: [], action: 'approve', admin_breakglass: false })
      .mockResolvedValueOnce({
        route_kind: 'finance_admin',
        approvers: [{ id: 'u-admin', name: 'Sari Admin', role: 'Admin' }],
        action: 'pay',
        admin_breakglass: false,
      });
    const client = fresh();
    const { result, rerender } = renderHook(
      ({ action }: { action: 'approve' | 'pay' }) => useImprestRequesterRoute('replenishment', 'r1', action),
      { wrapper: wrap(client), initialProps: { action: 'approve' as const } },
    );
    await waitFor(() => expect(result.current.data?.action).toBe('approve'));
    // The record transitions Requested -> Approved: the same record id must not serve the cached approval answer.
    rerender({ action: 'pay' as const });
    await waitFor(() => expect(result.current.data?.action).toBe('pay'));
    expect(imprest.getRequesterRoute).toHaveBeenCalledTimes(2);
    expect(imprest.getRequesterRoute).toHaveBeenLastCalledWith('replenishment', 'r1');
    const keys = client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(keys.some((k) => k.includes('"pay"'))).toBe(true);
    expect(keys.some((k) => k.includes('"approve"'))).toBe(true);
  });
});
