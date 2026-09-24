import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  getOrgLifecycleState: vi.fn(),
  currentUser: undefined as { id: string; org_id: string } | null | undefined,
  role: 'Admin' as string,
}));
vi.mock('@/src/lib/db/orgs', () => ({ getOrgLifecycleState: h.getOrgLifecycleState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.currentUser, role: h.role }),
}));

import { useDemoEligibility } from '../useDemoEligibility';

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  vi.clearAllMocks();
  h.currentUser = { id: 'u1', org_id: 'org-1' };
  h.role = 'Admin';
});

// AC-AUTH-013/014 — the demo-eligibility tri-state that gates the Admin view-as control.
// FAIL CLOSED is the contract: only a resolved lifecycle_state of exactly 'demo' is
// 'eligible'; loading and error both collapse to 'pending' (never 'eligible').
describe('useDemoEligibility — demo-org gate for the Admin view-as control (FR-AUTH-036/037)', () => {
  it("maps a resolved 'demo' org to 'eligible'", async () => {
    h.getOrgLifecycleState.mockResolvedValue('demo');
    const { result } = renderHook(() => useDemoEligibility(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current).toBe('eligible'));
  });

  it.each([
    ['live org (the RIS case)', 'live'],
    ['test org', 'test'],
  ] as const)('maps a resolved %s to ineligible', async (_label, state) => {
    h.getOrgLifecycleState.mockResolvedValue(state);
    const { result } = renderHook(() => useDemoEligibility(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current).toBe('ineligible'));
  });

  it('maps NULL / unknown state values to ineligible (fail closed)', async () => {
    h.getOrgLifecycleState.mockResolvedValue(null);
    const { result } = renderHook(() => useDemoEligibility(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current).toBe('ineligible'));
  });

  it('stays pending (fail closed) while the org state is loading', () => {
    let resolve!: (v: string) => void;
    h.getOrgLifecycleState.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const { result } = renderHook(() => useDemoEligibility(), { wrapper: wrap(freshClient()) });
    expect(result.current).toBe('pending');
    resolve('demo');
    return waitFor(() => expect(result.current).toBe('eligible'));
  });

  it('stays pending (fail closed) when the org-state read errors — never eligible', async () => {
    h.getOrgLifecycleState.mockRejectedValue(new Error('org read failed'));
    const client = freshClient();
    const { result } = renderHook(() => useDemoEligibility(), { wrapper: wrap(client) });
    await waitFor(() => expect(client.getQueryState(['org-lifecycle-state', 'org-1'])?.status).toBe('error'));
    expect(result.current).toBe('pending');
  });

  it('rechecks a cached demo result on remount before allowing impersonation', async () => {
    const client = freshClient();
    h.getOrgLifecycleState.mockResolvedValueOnce('demo');
    const first = renderHook(() => useDemoEligibility(), { wrapper: wrap(client) });
    await waitFor(() => expect(first.result.current).toBe('eligible'));
    first.unmount();

    let resolve!: (value: string) => void;
    h.getOrgLifecycleState.mockReturnValueOnce(new Promise<string>((r) => { resolve = r; }));
    const second = renderHook(() => useDemoEligibility(), { wrapper: wrap(client) });
    expect(second.result.current).toBe('pending');
    await waitFor(() => expect(h.getOrgLifecycleState).toHaveBeenCalledTimes(2));
    resolve('live');
    await waitFor(() => expect(second.result.current).toBe('ineligible'));
  });

  it('is disabled without a current user — stays pending and never calls the DAL', () => {
    h.currentUser = null;
    const { result } = renderHook(() => useDemoEligibility(), { wrapper: wrap(freshClient()) });
    expect(result.current).toBe('pending');
    expect(h.getOrgLifecycleState).not.toHaveBeenCalled();
  });

  it('does not query lifecycle for non-Admins', () => {
    h.role = 'Engineer';
    const { result } = renderHook(() => useDemoEligibility(), { wrapper: wrap(freshClient()) });
    expect(result.current).toBe('pending');
    expect(h.getOrgLifecycleState).not.toHaveBeenCalled();
  });
});
