import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { milestone } = vi.hoisted(() => ({
  milestone: {
    deliveryForProjects: vi.fn(),
    deliverySummaryForProjects: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { milestone } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

import { useProjectsDelivery, useProjectsDeliverySummary } from './useProjectsDelivery';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  milestone.deliveryForProjects.mockReset();
  milestone.deliverySummaryForProjects.mockReset();
  milestone.deliveryForProjects.mockResolvedValue({ 'p1': 32, 'p2': 100 });
  milestone.deliverySummaryForProjects.mockResolvedValue({
    p1: { deliveryPct: 75, committedSpend: 500000, budget: 900000 },
  });
});

describe('useProjectsDelivery', () => {
  it('useProjectsDeliverySummary returns the summary map', async () => {
    const ids = ['p1'];
    const { result } = renderHook(() => useProjectsDeliverySummary(ids), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(milestone.deliverySummaryForProjects).toHaveBeenCalledTimes(1);
    expect(milestone.deliverySummaryForProjects).toHaveBeenCalledWith(['p1']);
    expect(result.current.data).toEqual({
      p1: { deliveryPct: 75, committedSpend: 500000, budget: 900000 },
    });
  });

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

  /**
   * B-0.1 (CRITICAL) — cache-key collision fix.
   * useProjectsDelivery ('pct') and useProjectsDeliverySummary ('summary') must use
   * DISTINCT React-Query keys so a wrong-shaped cached value is never served
   * cross-consumer.  The shared QueryClient below proves the two hooks co-exist
   * without cross-contamination.
   */
  it('AC-B-0-1: pct and summary hooks use distinct query keys (no cache collision)', async () => {
    const sharedClient = freshClient();
    const pctWrapper = wrap(sharedClient);

    // Render both hooks against the same QueryClient
    const { result: pctResult } = renderHook(() => useProjectsDelivery(['p1']), {
      wrapper: pctWrapper,
    });
    const { result: summaryResult } = renderHook(() => useProjectsDeliverySummary(['p1']), {
      wrapper: pctWrapper,
    });

    await waitFor(() => expect(pctResult.current.isSuccess).toBe(true));
    await waitFor(() => expect(summaryResult.current.isSuccess).toBe(true));

    // pct hook returns number values
    expect(typeof Object.values(pctResult.current.data ?? {})[0]).toBe('number');
    // summary hook returns object values (not a number, not cross-contaminated)
    const summaryVal = Object.values(summaryResult.current.data ?? {})[0];
    expect(typeof summaryVal).toBe('object');
    expect(summaryVal).toHaveProperty('deliveryPct');

    // Both RPCs were called independently
    expect(milestone.deliveryForProjects).toHaveBeenCalledWith(['p1']);
    expect(milestone.deliverySummaryForProjects).toHaveBeenCalledWith(['p1']);
  });
});
