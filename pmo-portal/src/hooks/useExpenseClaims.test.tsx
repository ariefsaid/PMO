import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { expenseClaim } = vi.hoisted(() => ({
  expenseClaim: {
    list: vi.fn(), get: vi.fn(), lines: vi.fn(), create: vi.fn(), update: vi.fn(), addLine: vi.fn(),
    updateLine: vi.fn(), removeLine: vi.fn(), transition: vi.fn(), recordReturn: vi.fn(), outstanding: vi.fn(),
    routes: vi.fn(), aging: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { expenseClaim } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { useExpenseClaims, useExpenseClaimMutations, useExpenseClaimsAwaitingDecision, EXPENSE_QUERY_ROOTS } from './useExpenseClaims';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  for (const fn of Object.values(expenseClaim)) fn.mockReset();
  expenseClaim.list.mockResolvedValue({ rows: [{ id: 'c1', status: 'Submitted' }], truncated: false });
  expenseClaim.routes.mockResolvedValue([{ claimId: 'c1', route: 'flat', reason: 'no_project', approvers: [] }]);
  expenseClaim.transition.mockResolvedValue(undefined);
});

describe('AC-EXP-053 useExpenseClaims', () => {
  it('AC-EXP-053 the list is keyed by org and filters', async () => {
    const client = fresh();
    const { result } = renderHook(() => useExpenseClaims({ kind: 'claim' }), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(expenseClaim.list).toHaveBeenCalledWith({ kind: 'claim' });
    expect(client.getQueryData(['expense-claims', 'org-1', { kind: 'claim' }])).toBeTruthy();
  });

  it('AC-EXP-053 awaiting = Submitted rows plus ONE routes call', async () => {
    const client = fresh();
    const { result } = renderHook(() => useExpenseClaimsAwaitingDecision(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(expenseClaim.list).toHaveBeenCalledWith({ status: 'Submitted' });
    expect(expenseClaim.routes).toHaveBeenCalledTimes(1);
    expect(expenseClaim.routes).toHaveBeenCalledWith(['c1']);
    expect(result.current.data?.[0].route?.route).toBe('flat');
  });

  it('AC-EXP-053 a failed routes read leaves rows unrouted (the server still enforces)', async () => {
    expenseClaim.routes.mockRejectedValue(new Error('boom'));
    const client = fresh();
    const { result } = renderHook(() => useExpenseClaimsAwaitingDecision(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].route).toBeNull();
  });

  it('AC-EXP-053 a write invalidates every expense read', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useExpenseClaimMutations(), { wrapper: wrap(client) });
    await act(async () => { await result.current.transition.mutateAsync({ id: 'c1', to: 'Submitted' }); });
    expect(expenseClaim.transition).toHaveBeenCalledWith('c1', 'Submitted', { notes: null, paymentReference: null });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const root of EXPENSE_QUERY_ROOTS) expect(keys).toContain(JSON.stringify([root]));
  });
});
