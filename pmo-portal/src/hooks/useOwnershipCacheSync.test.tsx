import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * ADR-0056 — useOwnershipCacheSync seeds the module-level ownership cache load-on-auth: on a
 * successful `useExternalDomainOwnership()` resolve it calls `setTaskOwnership(data)`; while
 * loading/absent/on unmount (sign-out — this hook is mounted only in the authenticated Shell) it
 * calls `clearOwnershipCache()` so `routeTaskWrite()` stays fail-closed to 'pmo'.
 */

const h = vi.hoisted(() => ({
  useExternalDomainOwnership: vi.fn(),
  setTaskOwnership: vi.fn(),
  clearOwnershipCache: vi.fn(),
}));

vi.mock('./useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: h.useExternalDomainOwnership,
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  setTaskOwnership: h.setTaskOwnership,
  clearOwnershipCache: h.clearOwnershipCache,
}));

import { useOwnershipCacheSync } from './useOwnershipCacheSync';

beforeEach(() => {
  h.useExternalDomainOwnership.mockReset();
  h.setTaskOwnership.mockReset();
  h.clearOwnershipCache.mockReset();
});

describe('useOwnershipCacheSync', () => {
  it('calls setTaskOwnership(data) once the query resolves successfully', () => {
    const rows = [{ id: 'r1', orgId: 'org-1', externalTier: 'clickup', domain: 'tasks' }];
    h.useExternalDomainOwnership.mockReturnValue({ data: rows, isSuccess: true });
    renderHook(() => useOwnershipCacheSync());
    expect(h.setTaskOwnership).toHaveBeenCalledWith(rows);
  });

  it('calls clearOwnershipCache while the query has no data yet (cold start / loading)', () => {
    h.useExternalDomainOwnership.mockReturnValue({ data: undefined, isSuccess: false });
    renderHook(() => useOwnershipCacheSync());
    expect(h.clearOwnershipCache).toHaveBeenCalled();
    expect(h.setTaskOwnership).not.toHaveBeenCalled();
  });

  it('clears the cache on unmount (sign-out — the hook lives only in the authenticated Shell)', () => {
    h.useExternalDomainOwnership.mockReturnValue({ data: [], isSuccess: true });
    const { unmount } = renderHook(() => useOwnershipCacheSync());
    h.clearOwnershipCache.mockClear();
    unmount();
    expect(h.clearOwnershipCache).toHaveBeenCalled();
  });
});
