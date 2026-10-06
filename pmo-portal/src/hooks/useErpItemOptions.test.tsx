import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useErpItemOptions } from './useErpItemOptions';
import { queryClient } from '@/src/lib/queryClient';

const state = vi.hoisted(() => ({
  orgId: 'org-test' as string | undefined,
  external: false,
  ownership: vi.fn(async () => [] as Array<{ domain: string; externalTier: string }>),
  listItems: vi.fn(async () => [{ code: 'ITEM-TEST', name: 'Test service' }]),
  // Every case runs on an ACTIVE binding: the binding alone must never switch lines to the ERP catalog.
  getBinding: vi.fn(async () => ({ status: 'active', config: { company: 'Test Co' } })),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: state.orgId } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { listItems: state.listItems, getBinding: state.getBinding } } }));
vi.mock('@/src/lib/db/externalDomainOwnership', () => ({ listOwnExternalDomainOwnership: state.ownership }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: () => state.external ? 'external' : 'pmo' }));

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  state.orgId = 'org-test';
  state.external = false;
  state.ownership.mockResolvedValue([]);
});
afterEach(() => queryClient.clear());

describe('ERP item options repository seam', () => {
  it('uses the ERP catalog when ERPNext owns the line domain, and caches code/name options per purpose', async () => {
    state.ownership.mockResolvedValue([{ domain: 'revenue', externalTier: 'erpnext' }]);
    const { result } = renderHook(() => useErpItemOptions('sales'));
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(await result.current.loadOptions()).toEqual([{ value: 'ITEM-TEST', label: 'ITEM-TEST', sub: 'Test service' }]);
    await result.current.loadOptions();
    expect(state.listItems).toHaveBeenCalledTimes(1);
    expect(state.listItems).toHaveBeenCalledWith('sales');
  });

  // ADR-0055: the ERP is the source of truth per DOMAIN, not per binding. A connected org that still
  // runs procurement natively never pushes those lines to the ERP (create_purchase_order etc. route
  // to the adapter only when `domain_externally_owned(org,'procurement')`), so it keeps free-text
  // lines — requiring an ERP item there blocked adding a line whenever the catalog was unreachable.
  it('keeps free-text lines on a connected org whose line domain is not employed', async () => {
    state.ownership.mockResolvedValue([{ domain: 'revenue', externalTier: 'erpnext' }]);
    const { result } = renderHook(() => useErpItemOptions('purchase'));
    await waitFor(() => expect(state.ownership).toHaveBeenCalled());
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(result.current.connected).toBe(false);
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
    expect(state.ownership).not.toHaveBeenCalled();
    expect(state.listItems).not.toHaveBeenCalled();
  });
});
