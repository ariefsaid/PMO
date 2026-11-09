// Plan-surface reads — freshness + identity scoping.
//
// Two regressions from the client-cache-defaults slice are pinned here:
//   • `['ownPlan']` was a single unscoped key with infinite freshness, so a user moved to another
//     org kept reading the previous org's plan (review finding 3).
//   • every plan-surface read never aged, so an operator's change in ANOTHER session never reached
//     an already signed-in member (review finding 2).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  getOwnPlan: vi.fn(),
  listOwn: vi.fn(),
  auth: { currentUser: { id: 'u1', org_id: 'org-1' } as { id: string; org_id: string } | null },
}));

vi.mock('@/src/lib/repositories/admin', () => ({
  orgFeatureRepository: {
      getOwnPlan: h.getOwnPlan,
      listOwn: h.listOwn,
    },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.auth.currentUser, role: 'Admin' }),
}));

import { useOwnPlan } from './usePlans';
import { useOrgFeatures } from './useOrgFeatures';
import { SERVER_SESSION_STALE_TIME } from '@/src/lib/queryPolicies';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.currentUser = { id: 'u1', org_id: 'org-1' };
});

describe('useOwnPlan — caller-scoped plan cache', () => {
  it('keys the own plan by org, so a same-user org move reads the new org plan', async () => {
    h.getOwnPlan.mockResolvedValue({ planId: 'starter', planName: 'Starter' });
    const client = makeClient();
    const { result, rerender } = renderHook(() => useOwnPlan(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual({ planId: 'starter', planName: 'Starter' }));
    expect(h.getOwnPlan).toHaveBeenCalledTimes(1);

    h.auth.currentUser = { id: 'u1', org_id: 'org-2' };
    h.getOwnPlan.mockResolvedValue({ planId: 'enterprise', planName: 'Enterprise' });
    rerender();

    await waitFor(() => expect(result.current.data).toEqual({ planId: 'enterprise', planName: 'Enterprise' }));
    expect(h.getOwnPlan).toHaveBeenCalledTimes(2);
  });

  it('ages the plan instead of caching it forever, and revalidates on focus and on an interval', async () => {
    h.getOwnPlan.mockResolvedValue(null);
    const client = makeClient();
    const { result } = renderHook(() => useOwnPlan(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.data).toBeNull());

    const query = client.getQueryCache().find({ queryKey: ['ownPlan', 'org-1'] });
    const options = query?.options as
      | { staleTime?: number; gcTime?: number; refetchOnWindowFocus?: boolean; refetchInterval?: unknown }
      | undefined;
    expect(options).toMatchObject({
      staleTime: SERVER_SESSION_STALE_TIME,
      refetchOnWindowFocus: true,
      refetchInterval: SERVER_SESSION_STALE_TIME,
    });
    expect(options?.staleTime).not.toBe(Infinity);
  });

  it('serves every mounted consumer from one shared read inside the freshness window', async () => {
    h.getOwnPlan.mockResolvedValue(null);
    const client = makeClient();
    const wrapper = makeWrapper(client);
    renderHook(() => useOwnPlan(), { wrapper });
    const second = renderHook(() => useOwnPlan(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(h.getOwnPlan).toHaveBeenCalledTimes(1);
  });
});

describe('useOrgFeatures — own-org entitlement set freshness', () => {
  it('ages the entitlement set (bounded) and shares one read across components', async () => {
    h.listOwn.mockResolvedValue({ display: { revenue: true }, states: {} });
    const client = makeClient();
    const wrapper = makeWrapper(client);
    const first = renderHook(() => useOrgFeatures(), { wrapper });
    const second = renderHook(() => useOrgFeatures(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toEqual({ revenue: true }));
    await waitFor(() => expect(second.result.current.data).toEqual({ revenue: true }));
    expect(h.listOwn).toHaveBeenCalledTimes(1);

    const query = client.getQueryCache().find({ queryKey: ['orgFeatures', 'own', 'org-1'] });
    const options = query?.options as { staleTime?: number; refetchOnWindowFocus?: boolean } | undefined;
    expect(options?.staleTime).toBe(SERVER_SESSION_STALE_TIME);
    expect(options?.refetchOnWindowFocus).toBe(true);
  });
});
