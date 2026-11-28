import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  isPm: true,
  mayOrder: false,
  caseRead: false,
  mayOrderCalls: 0,
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    procurement: {
      mayOrderPurchases: () => { h.mayOrderCalls += 1; return Promise.resolve(h.mayOrder); },
      mayReadPurchaseCases: () => Promise.resolve(h.caseRead),
    },
  },
}));

import { useProcurementListScope } from './useProcurementListScope';

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { h.isPm = true; h.mayOrder = false; h.caseRead = false; h.mayOrderCalls = 0; });

describe('useProcurementListScope', () => {
  it('PERF-1128: a Project Manager without wider rights waits for the rights reads, then scopes to their id', async () => {
    const { result } = renderHook(() => useProcurementListScope(h.isPm), { wrapper: wrap });
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.scopeUserId).toBe('u1');
  });

  it('PERF-1128: a Project Manager who may order reads the whole list (no scope)', async () => {
    h.mayOrder = true;
    const { result } = renderHook(() => useProcurementListScope(h.isPm), { wrapper: wrap });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.scopeUserId).toBeUndefined();
  });

  it('PERF-1128: other roles are ready at once, unscoped, and make no rights read', () => {
    h.isPm = false;
    const { result } = renderHook(() => useProcurementListScope(h.isPm), { wrapper: wrap });
    expect(result.current).toEqual({ scopeUserId: undefined, ready: true });
    expect(h.mayOrderCalls).toBe(0);
  });
});
