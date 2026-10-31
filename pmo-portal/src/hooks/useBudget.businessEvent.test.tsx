import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ activateVersion: vi.fn(), track: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget: { activateVersion: h.activateVersion } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user', org_id: 'org', role: 'Finance' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useOptionalRealRole: () => 'Finance' }));
vi.mock('@/src/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/analytics')>()),
  trackBudgetActivated: h.track,
}));
import { useBudgetMutations } from './useBudget';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('AC-PHO-040/041 budget_activated', () => {
  beforeEach(() => { h.activateVersion.mockReset(); h.track.mockReset(); });

  it('AC-PHO-040 fires once with the real role when activation succeeds', async () => {
    h.activateVersion.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useBudgetMutations('p'), { wrapper });
    await act(async () => { await result.current.activate.mutateAsync('v'); });
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith('Finance');
  });

  it('AC-PHO-041 fires nothing when activation fails', async () => {
    h.activateVersion.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useBudgetMutations('p'), { wrapper });
    await act(async () => { await result.current.activate.mutateAsync('v').catch(() => {}); });
    expect(h.track).not.toHaveBeenCalled();
  });
});
