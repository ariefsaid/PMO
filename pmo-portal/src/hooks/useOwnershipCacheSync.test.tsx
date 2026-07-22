import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  listProjectBindings: vi.fn(),
}));

vi.mock('./useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: h.useExternalDomainOwnership,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { listProjectBindings: h.listProjectBindings } } }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  setTaskOwnership: h.setTaskOwnership,
  clearOwnershipCache: h.clearOwnershipCache,
  setProjectBindings: vi.fn(),
}));

import { useOwnershipCacheSync } from './useOwnershipCacheSync';

beforeEach(() => {
  h.useExternalDomainOwnership.mockReset();
  h.setTaskOwnership.mockReset();
  h.clearOwnershipCache.mockReset();
  h.listProjectBindings.mockReset();
  h.listProjectBindings.mockResolvedValue([]);
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useOwnershipCacheSync', () => {
  it('calls setTaskOwnership(data) once the query resolves successfully', async () => {
    const rows = [{ id: 'r1', orgId: 'org-1', externalTier: 'clickup', domain: 'tasks' }];
    h.useExternalDomainOwnership.mockReturnValue({ data: rows, isSuccess: true });
    renderHook(() => useOwnershipCacheSync(), { wrapper });
    await waitFor(() => expect(h.setTaskOwnership).toHaveBeenCalledWith(rows));
  });

  it('calls clearOwnershipCache while the query has no data yet (cold start / loading)', () => {
    h.useExternalDomainOwnership.mockReturnValue({ data: undefined, isSuccess: false });
    renderHook(() => useOwnershipCacheSync(), { wrapper });
    expect(h.clearOwnershipCache).toHaveBeenCalled();
    expect(h.setTaskOwnership).not.toHaveBeenCalled();
  });

  it('clears the cache on unmount (sign-out — the hook lives only in the authenticated Shell)', () => {
    h.useExternalDomainOwnership.mockReturnValue({ data: [], isSuccess: true });
    const { unmount } = renderHook(() => useOwnershipCacheSync(), { wrapper });
    h.clearOwnershipCache.mockClear();
    unmount();
    expect(h.clearOwnershipCache).toHaveBeenCalled();
  });
});
