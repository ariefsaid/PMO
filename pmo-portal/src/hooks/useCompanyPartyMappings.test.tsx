import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const listPartyIds = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({ repositories: { companyCollections: { listPartyIds } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
import { useCompanyPartyMappings } from './useCompanyPartyMappings';

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
beforeEach(() => { listPartyIds.mockReset(); });
describe('company party mappings', () => {
  it('loads mapped company IDs through the repository', async () => {
    listPartyIds.mockResolvedValue(['company-a']);
    const { result } = renderHook(() => useCompanyPartyMappings(['company-b', 'company-a'], true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.ids).toEqual(['company-a']));
    expect(listPartyIds).toHaveBeenCalledWith(['company-a', 'company-b']);
  });
  it('does not return mappings when the read fails', async () => {
    listPartyIds.mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useCompanyPartyMappings(['company-a'], true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.ids).toEqual([]);
  });
  it('does not read mappings for native ownership', () => {
    renderHook(() => useCompanyPartyMappings(['company-a'], false), { wrapper: Wrapper });
    expect(listPartyIds).not.toHaveBeenCalled();
  });
});
