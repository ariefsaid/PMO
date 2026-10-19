import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ list: vi.fn(async () => [{ id: 'si-n1' }]) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: { listInvoices: h.list } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { nativeDraftInvoicesKey, useNativeDraftInvoices } from './useRevenue';

const wrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => h.list.mockClear());

describe('useNativeDraftInvoices (#784 DD-NAR-12)', () => {
  it('AC-NAR-002 reads only PMO drafts for the approvals queue', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNativeDraftInvoices(true), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'si-n1' }]));
    expect(h.list).toHaveBeenCalledWith({ status: 'Draft', nativeOnly: true });
    expect(client.getQueryData(nativeDraftInvoicesKey('org-1'))).toBe(result.current.data);
  });
  it('AC-NAR-002 does not read at all for a viewer who cannot approve', () => {
    renderHook(() => useNativeDraftInvoices(false), { wrapper: wrapper(new QueryClient()) });
    expect(h.list).not.toHaveBeenCalled();
  });
});
