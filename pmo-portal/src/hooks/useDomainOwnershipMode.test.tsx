import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';

const state = vi.hoisted(() => ({ data: undefined as { domain: string }[] | undefined, isError: false, refetch: vi.fn() }));
const listBindings = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => state }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { listProjectBindings: listBindings } } }));
import { useDomainOwnershipMode } from './useDomainOwnershipMode';

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
afterEach(() => { clearOwnershipCache(); state.data = undefined; state.isError = false; state.refetch.mockClear(); listBindings.mockReset().mockResolvedValue([]); });
describe('domain ownership mode', () => {
  it('holds until the query and cache agree and responds to ownership changes', async () => {
    const { result, rerender } = renderHook(() => useDomainOwnershipMode('companies'), { wrapper: Wrapper });
    expect(result.current.mode).toBe('unknown');
    state.data = [];
    act(() => { setTaskOwnership([]); setProjectBindings([]); });
    rerender();
    await waitFor(() => expect(result.current.mode).toBe('pmo'));
    state.data = [{ domain: 'companies' }];
    act(() => setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]));
    rerender();
    expect(result.current.mode).toBe('external');
  });
  it('reports a failed binding read instead of advertising native writes', async () => {
    state.data = [];
    listBindings.mockRejectedValueOnce(new Error('unavailable'));
    act(() => { setTaskOwnership([]); setProjectBindings([]); });
    const { result } = renderHook(() => useDomainOwnershipMode('companies'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.mode).toBe('error'));
  });
  it('reports a failed ownership read rather than native mode and exposes retry', async () => {
    state.data = [];
    state.isError = true;
    const { result } = renderHook(() => useDomainOwnershipMode('companies'), { wrapper: Wrapper });
    expect(result.current.mode).toBe('error');
    act(() => result.current.retry());
    expect(state.refetch).toHaveBeenCalled();
  });
});
