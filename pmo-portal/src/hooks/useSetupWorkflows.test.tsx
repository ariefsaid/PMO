import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: false, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: {
  getSetupWorkflowsEnabled: state.get,
  setSetupWorkflowsEnabled: state.set,
} } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));

import { useSetupWorkflows } from './useSetupWorkflows';

beforeEach(() => {
  state.enabled = false;
  state.get.mockReset().mockImplementation(async () => state.enabled);
  state.set.mockReset().mockImplementation(async (enabled: boolean) => { state.enabled = enabled; return enabled; });
});

describe('useSetupWorkflows', () => {
  it('reads the org-scoped setting and refreshes the opt-in after an Admin change', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSetupWorkflows(), { wrapper });

    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
    expect(client.getQueryData(['orgSetupWorkflows', 'org-1'])).toBe(false);
    await act(async () => { result.current.setEnabled(true); });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    expect(state.set).toHaveBeenCalledWith(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orgSetupWorkflows'] });
  });
});
