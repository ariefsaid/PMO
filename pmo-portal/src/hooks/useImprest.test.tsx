import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { imprest, orgSettings } = vi.hoisted(() => ({
  orgSettings: { listSpendApprovers: vi.fn() },
  imprest: {
    listFloats: vi.fn(), getFloat: vi.fn(), getPosition: vi.fn(), getPositions: vi.fn(), getPlanUsage: vi.fn(), floatChoices: vi.fn(), listPlans: vi.fn(),
    listPlanLines: vi.fn(), listReplenishments: vi.fn(), listCounts: vi.fn(), createPlan: vi.fn(), savePlanLine: vi.fn(),
    deletePlanLine: vi.fn(), setProcurementLimit: vi.fn(), establishFloat: vi.fn(), proposeFloatAmount: vi.fn(),
    decideFloatChange: vi.fn(), transitionPlan: vi.fn(), requestReplenishment: vi.fn(), transitionReplenishment: vi.fn(),
    recordCount: vi.fn(), listPostingStates: vi.fn(), setCashAccount: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { imprest, orgSettings } }));
let org: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: org } }) }));

import {
  IMPREST_QUERY_ROOTS, useImprestFloats, useImprestPosition, useImprestPlanUsage, useImprestPlans, useImprestReplenishments,
  useImprestCounts, useImprestFloatChoices, useImprestFloat, useRequestReplenishment, useTransitionPlan, useRecordCount, useEstablishFloat,
  useImprestPostingStates, useSetCashAccount, useImprestPositions,
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

describe('AC-IMP-083 imprest hooks', () => {
  it('AC-IMP-083 every query key carries the org id', async () => {
    const client = fresh();
    renderHook(() => {
      useImprestFloats(); useImprestPosition('f1'); useImprestPlanUsage('f1', '2026-11-01'); useImprestPlans('f1');
      useImprestReplenishments('f1'); useImprestCounts('f1'); useImprestFloatChoices('p1', 'Vehicle'); useImprestFloat('f1'); useImprestPostingStates('f1');
    }, { wrapper: wrap(client) });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const keys = client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey)).sort();
    expect(keys).toEqual([
      ['imprest-counts', 'org-1', 'f1'], ['imprest-float-choices', 'org-1', 'p1', 'Vehicle'], ['imprest-floats', 'org-1'], ['imprest-float', 'org-1', 'f1'],
      ['imprest-plan-usage', 'org-1', 'f1', '2026-11-01'], ['imprest-plans', 'org-1', 'f1'],
      ['imprest-position', 'org-1', 'f1'], ['imprest-replenishments', 'org-1', 'f1'], ['imprest-posting-states', 'org-1', 'f1'],
    ].map((k) => JSON.stringify(k)).sort());
  });

  it('AC-IMP-083 nothing is fetched without an org id or the required ids', async () => {
    org = undefined;
    const c1 = fresh();
    renderHook(() => { useImprestFloats(); useImprestPosition('f1'); }, { wrapper: wrap(c1) });
    org = 'org-1';
    const c2 = fresh();
    renderHook(() => { useImprestPosition(undefined); useImprestPlanUsage('f1', undefined); useImprestFloatChoices(undefined, null); },
      { wrapper: wrap(c2) });
    await new Promise((r) => setTimeout(r, 20));
    expect(imprest.listFloats).not.toHaveBeenCalled();
    expect(imprest.getPosition).not.toHaveBeenCalled();
    expect(imprest.getPlanUsage).not.toHaveBeenCalled();
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

describe('AC-PERF-2106-1 the /imprest list reads positions in one batch', () => {
  const position = (floatId: string) => ({ float_id: floatId, cash_book: 1, month: '2026-11-01' });

  it('AC-PERF-2106-1 one request for every float, and each float\'s own position entry is seeded', async () => {
    imprest.getPositions.mockResolvedValue([position('f1'), position('f2'), position('f3')]);
    const client = fresh();
    const { result } = renderHook(() => useImprestPositions(['f1', 'f2', 'f3']), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(imprest.getPositions).toHaveBeenCalledTimes(1);
    expect(imprest.getPositions).toHaveBeenCalledWith(['f1', 'f2', 'f3']);
    expect(imprest.getPosition).not.toHaveBeenCalled();
    expect([...result.current.byId.keys()]).toEqual(['f1', 'f2', 'f3']);
    // The record page's own key is warm: opening a float from the list shows its figures without a second request.
    await waitFor(() => expect(client.getQueryData(['imprest-position', 'org-1', 'f2'])).toMatchObject({ float_id: 'f2' }));
    expect(client.getQueryData(['imprest-positions', 'org-1', ['f1', 'f2', 'f3']])).toBeDefined();
  });

  it('AC-PERF-2106-1 no floats (or no org) means no position request', async () => {
    const client = fresh();
    renderHook(() => useImprestPositions([]), { wrapper: wrap(client) });
    org = undefined;
    renderHook(() => useImprestPositions(['f1']), { wrapper: wrap(fresh()) });
    await new Promise((r) => setTimeout(r, 20));
    expect(imprest.getPositions).not.toHaveBeenCalled();
  });

  it('AC-PERF-2106-1 a batched write invalidates the batch root too', async () => {
    expect(IMPREST_QUERY_ROOTS).toContain('imprest-positions');
  });
});
