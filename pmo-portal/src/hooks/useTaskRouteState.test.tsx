import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ ownership: { data: [] as { domain: string; externalTier: string }[], isError: false }, bindings: vi.fn() }));
vi.mock('./useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => state.ownership }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { listProjectBindings: state.bindings } } }));
import { clearOwnershipCache, setProjectBinding } from '@/src/lib/adapterSeam/ownershipCache';
import { useOwnershipCacheSync, useTaskRouteState } from './useOwnershipCacheSync';

afterEach(() => { clearOwnershipCache(); vi.resetAllMocks(); state.ownership = { data: [], isError: false }; });

it('tracks resolution, later binding changes and stale-data errors', async () => {
  let resolve!: (value: { project_id: string; external_tier: string }[]) => void;
  state.bindings.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(() => { useOwnershipCacheSync(); return useTaskRouteState('p1'); }, { wrapper });
  expect(result.current).toBe('unknown');
  await act(async () => resolve([]));
  await waitFor(() => expect(result.current).toBe('pmo'));
  act(() => setProjectBinding('p1', true));
  expect(result.current).toBe('external');
  state.ownership = { data: [], isError: true };
  rerender();
  expect(result.current).toBe('unknown');
  state.ownership = { data: [], isError: false };
  rerender();
  expect(result.current).toBe('pmo');
  state.bindings.mockRejectedValueOnce(new Error('binding read failed'));
  await act(async () => { await client.refetchQueries({ queryKey: ['integrations', 'project-bindings', 'org-1'] }); });
  await waitFor(() => expect(result.current).toBe('unknown'));
  state.bindings.mockResolvedValueOnce([{ project_id: 'p1', external_tier: 'clickup' }]);
  await act(async () => { await client.refetchQueries({ queryKey: ['integrations', 'project-bindings', 'org-1'] }); });
  await waitFor(() => expect(result.current).toBe('external'));
});
