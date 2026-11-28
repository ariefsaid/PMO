import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { listKeepers, listWarehouses } = vi.hoisted(() => ({ listKeepers: vi.fn(), listWarehouses: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master: { listKeepers, listWarehouses } } } }));
const currentUserValue = { id: 'me', org_id: 'org-1', role: 'Engineer', built_in_role: null } as Record<string, unknown>;
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: currentUserValue }) }));

import { useMyStockLocations } from './useStock';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useMyStockLocations', () => {
  beforeEach(() => {
    currentUserValue.id = 'me';
    // The legacy cases run as a Project Manager level account: no storekeeper fallback applies to them.
    currentUserValue.role = 'Project Manager';
    currentUserValue.built_in_role = null;
    listWarehouses.mockResolvedValue([
      { id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w-none' },
    ]);
  });

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
    // No storekeeper role to fill: the keeperless-location fallback stays off for this account.
    expect(result.current.keeps('w-none')).toBe(false);
  });

  it('keeps nothing while unread or when I keep no location and fill no storekeeper role', async () => {
    currentUserValue.role = 'Project Manager';
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

  it('2803 RR-3: a member filling storekeeper keeps a warehouse that names no keeper (level inclusion)', async () => {
    currentUserValue.role = 'Engineer';
    listKeepers.mockResolvedValue([
      { user_id: 'other', warehouse_id: 'w1' }, { user_id: 'other', warehouse_id: 'w2' },
    ]);
    const { result } = renderHook(() => useMyStockLocations(), { wrapper });
    await waitFor(() => expect(result.current.keeps('w-none')).toBe(true));
    expect(result.current.keeps('w3')).toBe(true);
    expect(result.current.keepsAny).toBe(true);
    // w1/w2 name a keeper: the fallback never reaches them.
    expect(result.current.keeps('w1')).toBe(false);
    expect(result.current.keeps('w2')).toBe(false);
  });

  it('2803 RR-3: the held storekeeper key keeps a keeperless warehouse; a held other key does not', async () => {
    currentUserValue.role = 'Engineer';
    listKeepers.mockResolvedValue([]);
    currentUserValue.built_in_role = 'storekeeper';
    const { result } = renderHook(() => useMyStockLocations(), { wrapper });
    await waitFor(() => expect(result.current.keeps('w1')).toBe(true));
    expect(result.current.keepsAny).toBe(true);
    currentUserValue.built_in_role = 'buyer';
    const keyed = renderHook(() => useMyStockLocations(), { wrapper });
    await waitFor(() => expect(keyed.result.current.isPending).toBe(false));
    expect(keyed.result.current.keeps('w1')).toBe(false);
    expect(keyed.result.current.keepsAny).toBe(false);
  });

  it('2803 RR-3: an unreadable keeper list grants no fallback', async () => {
    currentUserValue.role = 'Engineer';
    listKeepers.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useMyStockLocations(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.keeps('w-none')).toBe(false);
    expect(result.current.keepsAny).toBe(false);
  });
});
