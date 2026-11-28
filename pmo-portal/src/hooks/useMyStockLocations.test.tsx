import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { listKeepers } = vi.hoisted(() => ({ listKeepers: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master: { listKeepers } } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));

import { useMyStockLocations } from './useStock';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useMyStockLocations', () => {
  it("keeps only the locations where I am the keeper, never another keeper's", async () => {
    listKeepers.mockResolvedValue([
      { user_id: 'me', warehouse_id: 'w1' }, { user_id: 'other', warehouse_id: 'w2' }, { user_id: 'me', warehouse_id: 'w3' },
    ]);
    const { result } = renderHook(() => useMyStockLocations(), { wrapper });
    await waitFor(() => expect(result.current.keepsAny).toBe(true));
    expect([...result.current.ids].sort()).toEqual(['w1', 'w3']);
    expect(result.current.keeps('w1')).toBe(true);
    expect(result.current.keeps('w2')).toBe(false);
    expect(result.current.keeps(undefined)).toBe(false);
  });

  it('keeps nothing while unread or when I keep no location', async () => {
    listKeepers.mockResolvedValue([{ user_id: 'other', warehouse_id: 'w2' }]);
    const { result } = renderHook(() => useMyStockLocations(), { wrapper });
    expect(result.current.keepsAny).toBe(false);
    await waitFor(() => expect(listKeepers).toHaveBeenCalled());
    expect(result.current.keepsAny).toBe(false);
  });

  it('reports an unreadable list as an error and keeps nothing', async () => {
    listKeepers.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useMyStockLocations(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.keepsAny).toBe(false);
  });
});
