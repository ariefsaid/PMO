import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { profile: { listOrgProfiles: list } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }) }));

import { useOrgProfilesLoader } from './useOrgProfilesLoader';

describe('useOrgProfilesLoader', () => {
  it('#2114 a picker opened twice sends one profile request, and the loader keeps its identity', async () => {
    list.mockResolvedValue([{ id: 'p1', full_name: 'Pat' }]);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(() => useOrgProfilesLoader(), { wrapper });
    const first = result.current;
    expect(await first()).toEqual([{ id: 'p1', full_name: 'Pat' }]);
    rerender();
    expect(result.current).toBe(first);
    await result.current();
    expect(list).toHaveBeenCalledTimes(1);
  });
});
