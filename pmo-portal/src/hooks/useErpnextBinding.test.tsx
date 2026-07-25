import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hook consumes the repository seam (ADR-0017), not the DAL directly.
const { integrations } = vi.hoisted(() => ({
  integrations: { getBinding: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations } }));

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: authMock }));

import { useErpnextBinding } from './useErpnextBinding';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const activeBinding = {
  org_id: 'org-1',
  external_tier: 'erpnext',
  site_url: 'https://erp.example.test',
  secret_ref: 'ref',
  status: 'active',
  connected_by: null,
  connected_at: null,
  disconnected_at: null,
  config: {},
};

beforeEach(() => {
  integrations.getBinding.mockReset();
  authMock.mockReturnValue({ currentUser: { id: 'u1', org_id: 'org-1' } });
});

describe('useErpnextBinding — the spec-faithful ERPNext employ signal (FR-BUD-010)', () => {
  it('reads the org\'s erpnext binding via the repository seam', async () => {
    integrations.getBinding.mockResolvedValue(activeBinding);
    const { result } = renderHook(() => useErpnextBinding(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('active');
    expect(integrations.getBinding).toHaveBeenCalledWith('org-1', 'erpnext');
  });

  it('returns null for an org with no erpnext binding', async () => {
    integrations.getBinding.mockResolvedValue(null);
    const { result } = renderHook(() => useErpnextBinding(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled (no fetch) until an org is known', () => {
    authMock.mockReturnValue({ currentUser: undefined });
    const { result } = renderHook(() => useErpnextBinding(), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(integrations.getBinding).not.toHaveBeenCalled();
  });
});
