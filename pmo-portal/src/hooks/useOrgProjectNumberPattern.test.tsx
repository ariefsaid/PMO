import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { getProjectNumberPattern: h.get } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-771' } }) }));

import { useOrgProjectNumberPatternQuery, ORG_PROJECT_NUMBER_PATTERN_KEY } from './useOrgProjectNumberPattern';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  queryClient.clear();
  cleanup();
  vi.clearAllMocks();
});

function wrapper({ children }: React.PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useOrgProjectNumberPatternQuery', () => {
  it('reads only through the repository and keys the cache by the signed-in organisation', async () => {
    h.get.mockResolvedValue('PRE-{CLIENT}-{YY}-{SEQ4}');
    const { result } = renderHook(() => useOrgProjectNumberPatternQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe('PRE-{CLIENT}-{YY}-{SEQ4}'));
    expect(queryClient.getQueryData([ORG_PROJECT_NUMBER_PATTERN_KEY, 'org-771'])).toBe('PRE-{CLIENT}-{YY}-{SEQ4}');
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejected setting read in error state without manufacturing a default', async () => {
    h.get.mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useOrgProjectNumberPatternQuery(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
