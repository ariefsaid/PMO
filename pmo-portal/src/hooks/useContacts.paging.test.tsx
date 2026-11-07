import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The Contacts directory's query keys are the isolation seam (issue #1989): company filter,
 * search, page and page size are part of the key (plus org), so a response for an OLD view can
 * never be served as the new one. The 'All' company filter is the ABSENCE of a server filter.
 */
const h = vi.hoisted(() => ({
  listPage: vi.fn(),
  count: vi.fn(),
  listAll: vi.fn(),
  orgId: 'org-1' as string | undefined,
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    contact: {
      listPage: (...args: unknown[]) => h.listPage(...args),
      count: (...args: unknown[]) => h.count(...args),
      listAll: (...args: unknown[]) => h.listAll(...args),
    },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.orgId ? { id: 'u-me', org_id: h.orgId } : null }),
}));

import { CONTACTS_DIRECTORY_PAGE_SIZE, useContactsExportAll, useContactsPage } from './useContacts';

const wrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  h.listPage.mockReset();
  h.count.mockReset();
  h.listAll.mockReset();
  h.orgId = 'org-1';
});

describe('useContactsPage', () => {
  it('reads one server page through the repository with the company filter and search', async () => {
    h.listPage.mockResolvedValue({ rows: [{ id: 'ct1' }], total: 15 });
    const { result } = renderHook(
      () => useContactsPage({ companyId: 'c-1', search: 'har', page: 2, pageSize: CONTACTS_DIRECTORY_PAGE_SIZE }),
      { wrapper: wrapper(client()) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listPage).toHaveBeenCalledWith({ page: 2, pageSize: 50, companyId: 'c-1', search: 'har' });
  });

  it("the 'All' company filter sends NO company filter; a blank search sends none", async () => {
    h.listPage.mockResolvedValue({ rows: [], total: 0 });
    const { result } = renderHook(
      () => useContactsPage({ companyId: 'All', search: '  ', page: 1, pageSize: 50 }),
      { wrapper: wrapper(client()) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listPage).toHaveBeenCalledWith({ page: 1, pageSize: 50, companyId: undefined, search: undefined });
  });

  it('a filter/search/page change is a DIFFERENT cache entry — the old view is never served as the new one', async () => {
    h.listPage.mockImplementation(({ companyId, page }: { companyId?: string; page: number }) =>
      Promise.resolve({ rows: [{ id: `ct-${companyId ?? 'all'}-${page}` }], total: 15 }));
    const { result, rerender } = renderHook(
      (input: { companyId: string; search: string; page: number }) =>
        useContactsPage({ ...input, pageSize: 50 }),
      { wrapper: wrapper(client()), initialProps: { companyId: 'All', search: '', page: 1 } },
    );
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('ct-all-1'));
    rerender({ companyId: 'c-9', search: '', page: 1 });
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('ct-c-9-1'));
    rerender({ companyId: 'c-9', search: 'ha', page: 4 });
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('ct-c-9-4'));
    expect(h.listPage).toHaveBeenCalledTimes(3);
  });

  it('is disabled until an org is known', () => {
    h.orgId = undefined;
    renderHook(() => useContactsPage({ companyId: 'All', search: '', page: 1, pageSize: 50 }), {
      wrapper: wrapper(client()),
    });
    expect(h.listPage).not.toHaveBeenCalled();
  });
});

describe('useContactsExportAll', () => {
  it('fetches the FULL matching set for the export', async () => {
    h.listAll.mockResolvedValue([{ id: 'ct1' }, { id: 'ct2' }]);
    const { result } = renderHook(() => useContactsExportAll(), { wrapper: wrapper(client()) });
    await result.current.mutateAsync({ companyId: 'c-1', search: 'ha' });
    expect(h.listAll).toHaveBeenCalledWith({ companyId: 'c-1', search: 'ha' });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });
});
