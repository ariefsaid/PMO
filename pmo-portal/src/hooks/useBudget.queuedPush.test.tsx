import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ activateVersion: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget: { activateVersion: h.activateVersion } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user', org_id: 'org', role: 'Finance' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useOptionalRealRole: () => 'Finance' }));
import { useBudgetMutations } from './useBudget';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('#1030 push status reads Queued from activation until the push settles', () => {
  beforeEach(() => { h.activateVersion.mockReset(); queryClient.clear(); });

  it('seeds a pending row so the banner never says "No ERP budget yet" right after activation', async () => {
    h.activateVersion.mockResolvedValueOnce({ pushState: 'queued' });
    const { result } = renderHook(() => useBudgetMutations('p'), { wrapper });
    await act(async () => { await result.current.activate.mutateAsync('v'); });
    expect(queryClient.getQueryData(['budget-push-status', 'p'])).toEqual([
      expect.objectContaining({ pushState: 'pending', fiscalYear: null, pushError: null }),
    ]);
  });

  it('leaves the status untouched when activation fails', async () => {
    h.activateVersion.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useBudgetMutations('p'), { wrapper });
    await act(async () => { await result.current.activate.mutateAsync('v').catch(() => {}); });
    expect(queryClient.getQueryData(['budget-push-status', 'p'])).toBeUndefined();
  });

  it('the settle callback invalidates the status so the durable truth replaces the seed', async () => {
    let settle: () => void = () => {};
    h.activateVersion.mockImplementationOnce(async (_id: string, cb: () => void) => { settle = cb; return { pushState: 'queued' }; });
    const { result } = renderHook(() => useBudgetMutations('p'), { wrapper });
    await act(async () => { await result.current.activate.mutateAsync('v'); });
    act(() => settle());
    expect(queryClient.getQueryState(['budget-push-status', 'p'])?.isInvalidated).toBe(true);
  });
});
