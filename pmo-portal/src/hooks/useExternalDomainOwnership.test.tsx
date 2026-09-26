import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ orgId: 'org-a', listOwn: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: state.orgId ? { org_id: state.orgId } : null }),
}));
vi.mock('@/src/lib/db/externalDomainOwnership', () => ({
  listOwnExternalDomainOwnership: state.listOwn,
}));

import { useExternalDomainOwnership } from './useExternalDomainOwnership';

afterEach(() => {
  cleanup();
  state.orgId = 'org-a';
  state.listOwn.mockReset();
});

it('AC-IRUX-009: ownership rows are fetched and cached separately for each active organization', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  state.listOwn
    .mockResolvedValueOnce([{ id: 'a', orgId: 'org-a', externalTier: 'clickup', domain: 'tasks' }])
    .mockResolvedValueOnce([{ id: 'b', orgId: 'org-b', externalTier: 'erpnext', domain: 'procurement' }]);

  const { result, rerender } = renderHook(() => useExternalDomainOwnership(), { wrapper });
  await waitFor(() => expect(result.current.data?.[0]?.orgId).toBe('org-a'));

  state.orgId = 'org-b';
  rerender();
  await waitFor(() => expect(result.current.data?.[0]?.orgId).toBe('org-b'));

  expect(state.listOwn).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(['external-domain-ownership', 'org-a'])).toEqual([
    { id: 'a', orgId: 'org-a', externalTier: 'clickup', domain: 'tasks' },
  ]);
  expect(client.getQueryData(['external-domain-ownership', 'org-b'])).toEqual([
    { id: 'b', orgId: 'org-b', externalTier: 'erpnext', domain: 'procurement' },
  ]);
});
