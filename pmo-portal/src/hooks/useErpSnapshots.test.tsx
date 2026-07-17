import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// task FIX-2 (Discover CRITICAL 2) — the read hooks over the repository seam's `erpSnapshots`
// group (Slice 7, ADR-0048). Mirrors the useDashboard.ts org-scoped queryKey pattern.
const { erpSnapshots } = vi.hoisted(() => ({
  erpSnapshots: {
    actuals: vi.fn(),
    apAging: vi.fn(),
    arAging: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { erpSnapshots } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

import { useActualsSnapshot, useApAgingSnapshot, useArAgingSnapshot } from './useErpSnapshots';

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  vi.clearAllMocks();
  erpSnapshots.actuals.mockResolvedValue([]);
  erpSnapshots.apAging.mockResolvedValue([]);
  erpSnapshots.arAging.mockResolvedValue([]);
});

describe('useActualsSnapshot', () => {
  it("keys by ['erp-actuals-snapshot', orgId] and calls repositories.erpSnapshots.actuals", async () => {
    const row = [{ snapshotId: 's1', net: 100, asOf: '2026-07-13T00:00:00Z', sourceReport: 'GL Entry' }];
    erpSnapshots.actuals.mockResolvedValue(row);
    const { result } = renderHook(() => useActualsSnapshot(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(row);
    expect(erpSnapshots.actuals).toHaveBeenCalledTimes(1);
  });
});

describe('useApAgingSnapshot', () => {
  it('calls repositories.erpSnapshots.apAging and returns rows', async () => {
    const row = [{ snapshotId: 's1', party: 'Acme', totalOutstanding: 500 }];
    erpSnapshots.apAging.mockResolvedValue(row);
    const { result } = renderHook(() => useApAgingSnapshot(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(row);
  });
});

describe('useArAgingSnapshot', () => {
  it('calls repositories.erpSnapshots.arAging and returns rows', async () => {
    const row = [{ snapshotId: 's1', party: 'Beta Client', totalOutstanding: 250 }];
    erpSnapshots.arAging.mockResolvedValue(row);
    const { result } = renderHook(() => useArAgingSnapshot(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(row);
  });
});
