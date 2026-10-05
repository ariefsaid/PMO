import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useErpItemOptions } from './useErpItemOptions';
import { queryClient } from '@/src/lib/queryClient';

const state = vi.hoisted(() => ({
  orgId: 'org-test' as string | undefined,
  external: false,
  getBinding: vi.fn(async () => ({ status: 'active' })),
  listItems: vi.fn(async () => [{ code: 'ITEM-TEST', name: 'Test service' }]),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: state.orgId } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { getBinding: state.getBinding, listItems: state.listItems } } }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: () => state.external ? 'external' : 'pmo' }));

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  state.orgId = 'org-test';
  state.external = false;
});
afterEach(() => queryClient.clear());

describe('ERP item options repository seam', () => {
  it('uses an active own-org binding and caches code/name options for the requested purpose', async () => {
    const { result } = renderHook(() => useErpItemOptions('sales'));
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(state.getBinding).toHaveBeenCalledWith('org-test', 'erpnext');
    expect(await result.current.loadOptions()).toEqual([{ value: 'ITEM-TEST', label: 'ITEM-TEST', sub: 'Test service' }]);
    await result.current.loadOptions();
    expect(state.listItems).toHaveBeenCalledTimes(1);
    expect(state.listItems).toHaveBeenCalledWith('sales');
  });

  it('uses the purchase catalog on an already loaded external procurement route', async () => {
    state.external = true;
    const { result } = renderHook(() => useErpItemOptions('purchase'));
    expect(result.current.connected).toBe(true);
    await result.current.loadOptions();
    expect(state.listItems).toHaveBeenCalledWith('purchase');
  });

  it('refuses catalog loading without an authenticated org', async () => {
    state.orgId = undefined;
    const { result } = renderHook(() => useErpItemOptions('sales'));
    expect(result.current.connected).toBe(false);
    await expect(result.current.loadOptions()).rejects.toThrow('Sign in');
    expect(state.getBinding).not.toHaveBeenCalled();
    expect(state.listItems).not.toHaveBeenCalled();
  });
});
