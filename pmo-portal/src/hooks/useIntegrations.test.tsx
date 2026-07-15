import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock the integrations repository
const { integrations } = vi.hoisted(() => ({
  integrations: {
    getBinding: vi.fn(),
    listBindings: vi.fn(),
    connectIntegration: vi.fn(),
    disconnectIntegration: vi.fn(),
    getIntegrationHealth: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

import { useIntegrations } from './useIntegrations';
import type { IntegrationBinding, ConnectCredential, IntegrationHealth } from '@/src/lib/repositories/types';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const mockBinding: IntegrationBinding = {
  org_id: 'org-1',
  external_tier: 'clickup',
  site_url: 'https://api.clickup.com',
  secret_ref: 'clickup_token_org_1',
  status: 'active',
  connected_by: 'u1',
  connected_at: '2026-01-01T00:00:00Z',
  disconnected_at: null,
};

const mockHealth: IntegrationHealth = {
  tier: 'clickup',
  status: 'active',
  connected_by: 'u1',
  connected_at: '2026-01-01T00:00:00Z',
  last_sync: '2026-01-02T00:00:00Z',
  error_count: 0,
};

beforeEach(() => {
  integrations.listBindings.mockResolvedValue([mockBinding]);
  integrations.connectIntegration.mockResolvedValue({ ok: true, binding: { secret_ref: 'new_ref', status: 'active' } });
  integrations.disconnectIntegration.mockResolvedValue({ ok: true });
  integrations.getIntegrationHealth.mockResolvedValue(mockHealth);
});

afterEach(() => vi.clearAllMocks());

describe('useIntegrations', () => {
  it('AC-EAC-016: lists bindings for the org and keys by ["integrations", "bindings", orgId]', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.bindings).toEqual([mockBinding]);
    expect(integrations.listBindings).toHaveBeenCalledWith('org-1');
  });

  it('AC-EAC-007: connectIntegration calls repository with tier + credential and invalidates queries', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const credential: ConnectCredential = {
      tier: 'clickup',
      credential: { token: 'test-token' },
    };
    await act(async () => {
      await result.current.connect.mutateAsync(credential);
    });

    expect(integrations.connectIntegration).toHaveBeenCalledWith('org-1', credential);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations', 'bindings', 'org-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations', 'health', 'org-1', 'clickup'] });
  });

  it('AC-EAC-007: disconnectIntegration calls repository and invalidates queries', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.disconnect.mutateAsync('clickup');
    });

    expect(integrations.disconnectIntegration).toHaveBeenCalledWith('org-1', 'clickup');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations', 'bindings', 'org-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations', 'health', 'org-1', 'clickup'] });
  });

  it('getBinding returns binding for a specific tier from cached list', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const binding = result.current.getBinding('clickup');
    expect(binding).toEqual(mockBinding);
  });

  it('getHealth returns health data for a specific tier', async () => {
    const client = freshClient();
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const health = await result.current.getHealth('clickup');
    expect(health).toEqual(mockHealth);
    expect(integrations.getIntegrationHealth).toHaveBeenCalledWith('org-1', 'clickup');
  });
});