import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { getProjectClassificationOptions: h.get } } }));
import { useProjectClassificationOptions } from './useProjectClassificationOptions';
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...renderHook(() => useProjectClassificationOptions(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }) };
}
describe('AC-TAG-001 org-scoped classification option query', () => {
  it('reads through the repository and caches under the current org', async () => {
    h.get.mockResolvedValue({ serviceLines: ['Engineering'], sectors: ['Energy'] });
    const { client, result } = setup();
    await waitFor(() => expect(result.current.data).toEqual({ serviceLines: ['Engineering'], sectors: ['Energy'] }));
    expect(client.getQueryData(['project-classification-options', 'org-1'])).toEqual(result.current.data);
  });
  it('keeps failed reads unavailable instead of manufacturing configured options', async () => {
    h.get.mockRejectedValue(new Error('unavailable'));
    const { result } = setup();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
