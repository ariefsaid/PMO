import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { milestone } = vi.hoisted(() => ({
  milestone: {
    deliveryForProjects: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { milestone } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

import { useProjectsDelivery } from './useProjectsDelivery';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  milestone.deliveryForProjects.mockResolvedValue({ 'p1': 32, 'p2': 100 });
});

describe('useProjectsDelivery', () => {
  it('useProjectsDelivery fetches all delivery %s in one call (no N+1)', async () => {
    const ids = ['p1', 'p2'];
    const { result } = renderHook(() => useProjectsDelivery(ids), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // One call for all ids — not per-row.
    expect(milestone.deliveryForProjects).toHaveBeenCalledTimes(1);
    expect(milestone.deliveryForProjects).toHaveBeenCalledWith(['p1', 'p2']);
    expect(result.current.data?.['p1']).toBe(32);
    expect(result.current.data?.['p2']).toBe(100);
  });

  it('is disabled (no fetch) when ids is empty', () => {
    milestone.deliveryForProjects.mockClear();
    const { result } = renderHook(() => useProjectsDelivery([]), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(milestone.deliveryForProjects).not.toHaveBeenCalled();
  });
});
