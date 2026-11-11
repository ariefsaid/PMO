import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ transition: vi.fn(), track: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement: { transition: h.transition } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user', org_id: 'org', role: 'Finance' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useOptionalRealRole: () => 'Finance' }));
vi.mock('@/src/hooks/useStartRecordFolder', () => ({ useStartRecordFolder: () => vi.fn() }));
vi.mock('@/src/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/analytics')>()),
  trackPurchaseApproved: h.track,
}));
import { useProcurementMutations } from './useProcurementDetail';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('AC-PHO-040/041 purchase_approved (detail hook)', () => {
  beforeEach(() => { h.transition.mockReset(); h.track.mockReset(); });

  it('AC-PHO-040 fires once with the real role on a transition to Approved', async () => {
    h.transition.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useProcurementMutations('p'), { wrapper });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Approved' }); });
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith('Finance');
  });

  it('fires nothing on a transition to any other status', async () => {
    h.transition.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useProcurementMutations('p'), { wrapper });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Ordered' }); });
    expect(h.track).not.toHaveBeenCalled();
  });

  it('AC-PHO-041 fires nothing when the approval is refused', async () => {
    h.transition.mockRejectedValueOnce(new Error('refused'));
    const { result } = renderHook(() => useProcurementMutations('p'), { wrapper });
    await act(async () => { await result.current.transition.mutateAsync({ to: 'Approved' }).catch(() => {}); });
    expect(h.track).not.toHaveBeenCalled();
  });
});
