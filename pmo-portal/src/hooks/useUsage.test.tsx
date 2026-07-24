import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { usage, authState, isOperatorState } = vi.hoisted(() => ({
  usage: {
    getOrgUsageSummary: vi.fn(),
    getOperatorUsageSummary: vi.fn(),
    getOrgAgentRunStats: vi.fn(),
    getOperatorAgentRunStats: vi.fn(),
  },
  authState: { currentUser: { id: 'u1', org_id: 'org-1' } },
  isOperatorState: { value: false },
}));

vi.mock('@/src/lib/repositories', () => ({ repositories: { usage } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => authState }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => isOperatorState.value }));

import { useUsage, useAgentRunStats } from './useUsage';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  isOperatorState.value = false;
  usage.getOrgUsageSummary.mockResolvedValue([{ owner_id: 'u1', action: 'chat', month: '2026-07-01', run_count: 1, prompt_tokens: 1, completion_tokens: 1, provider_cost_usd: 0, cost: 0, margin_usd: null }]);
  usage.getOperatorUsageSummary.mockResolvedValue([]);
  usage.getOrgAgentRunStats.mockResolvedValue([]);
  usage.getOperatorAgentRunStats.mockResolvedValue([]);
});

describe('useUsage (AC-USE-001/002)', () => {
  it('a non-Operator org-Admin fetches NOTHING (assistant usage is Operator-only)', async () => {
    // Owner 2026-07-24: assistant cost/usage is a PLATFORM surface — an org-Admin must not see it
    // at all, not even their own org's rows. Gating the FETCH (not just the markup) keeps the
    // numbers out of the network tab. This test is the reason the query is disabled, not hidden.
    const { result } = renderHook(() => useUsage(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(usage.getOrgUsageSummary).not.toHaveBeenCalled();
    expect(usage.getOperatorUsageSummary).not.toHaveBeenCalled();
  });

  it('an Operator calls getOperatorUsageSummary with the org-switcher selection', async () => {
    isOperatorState.value = true;
    const { result } = renderHook(() => useUsage('org-2'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usage.getOperatorUsageSummary).toHaveBeenCalledWith('org-2');
    expect(usage.getOrgUsageSummary).not.toHaveBeenCalled();
  });

  it('an Operator with no org-switcher selection passes undefined (all orgs)', async () => {
    isOperatorState.value = true;
    const { result } = renderHook(() => useUsage(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usage.getOperatorUsageSummary).toHaveBeenCalledWith(undefined);
  });
});

describe('AC-ACD-008 useAgentRunStats', () => {
  it('a non-Operator org-Admin fetches NOTHING (run stats are Operator-only)', async () => {
    const { result } = renderHook(() => useAgentRunStats(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(usage.getOrgAgentRunStats).not.toHaveBeenCalled();
    expect(usage.getOperatorAgentRunStats).not.toHaveBeenCalled();
  });

  it('an Operator calls getOperatorAgentRunStats with the org-switcher selection', async () => {
    isOperatorState.value = true;
    const { result } = renderHook(() => useAgentRunStats('org-2'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usage.getOperatorAgentRunStats).toHaveBeenCalledWith('org-2');
    expect(usage.getOrgAgentRunStats).not.toHaveBeenCalled();
  });

  it('an Operator with no org-switcher selection passes undefined (all orgs)', async () => {
    isOperatorState.value = true;
    const { result } = renderHook(() => useAgentRunStats(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usage.getOperatorAgentRunStats).toHaveBeenCalledWith(undefined);
  });
});
