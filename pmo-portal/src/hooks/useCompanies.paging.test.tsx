import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The Companies directory's query keys are the isolation seam (issue #1989): filter, search, page
 * and page size are part of the key (plus org), so a response for an OLD view can never be served
 * as the new one, and a tenant switch cannot reuse another org's page. The 'All' filter is the
 * ABSENCE of a server type filter.
 */
const h = vi.hoisted(() => ({
  listPage: vi.fn(),
  count: vi.fn(),
  listOptions: vi.fn(),
  listAll: vi.fn(),
  orgId: 'org-1' as string | undefined,
}));

vi.mock('@/src/lib/repositories/companies', () => ({
  companyRepository: {
      listPage: (...args: unknown[]) => h.listPage(...args),
      count: (...args: unknown[]) => h.count(...args),
      listOptions: (...args: unknown[]) => h.listOptions(...args),
      listAll: (...args: unknown[]) => h.listAll(...args),
    },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.orgId ? { id: 'u-me', org_id: h.orgId } : null }),
}));

import {
  COMPANIES_DIRECTORY_PAGE_SIZE,
  useCompaniesExportAll,
  useCompaniesPage,
  useCompaniesTotal,
  useCompanyOptions,
} from './useCompanies';

const wrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  h.listPage.mockReset();
  h.count.mockReset();
  h.listOptions.mockReset();
  h.listAll.mockReset();
  h.orgId = 'org-1';
});

describe('useCompaniesPage', () => {
  it('reads one server page through the repository with the URL filter and search', async () => {
    h.listPage.mockResolvedValue({ rows: [{ id: 'c1' }], total: 21 });
    const { result } = renderHook(
      () => useCompaniesPage({ type: 'Vendor', search: 'volt', page: 2, pageSize: COMPANIES_DIRECTORY_PAGE_SIZE }),
      { wrapper: wrapper(client()) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listPage).toHaveBeenCalledWith({ page: 2, pageSize: 50, type: 'Vendor', search: 'volt' });
    expect(result.current.data).toEqual({ rows: [{ id: 'c1' }], total: 21 });
  });

  it("the 'All' filter sends NO type filter — the server filters only when a type is chosen", async () => {
    h.listPage.mockResolvedValue({ rows: [], total: 0 });
    const { result } = renderHook(
      () => useCompaniesPage({ type: 'All', search: '  ', page: 1, pageSize: 50 }),
      { wrapper: wrapper(client()) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listPage).toHaveBeenCalledWith({ page: 1, pageSize: 50, type: undefined, search: undefined });
  });

  it('a filter/search/page change is a DIFFERENT cache entry — the old view is never served as the new one', async () => {
    h.listPage.mockImplementation(({ type, search, page }: { type?: string; search?: string; page: number }) =>
      Promise.resolve({ rows: [{ id: `c-${type ?? 'all'}-${search || 'none'}-${page}` }], total: 21 }));
    const { result, rerender } = renderHook(
      (input: { type: 'All' | 'Vendor'; search: string; page: number }) =>
        useCompaniesPage({ ...input, pageSize: 50 }),
      { wrapper: wrapper(client()), initialProps: { type: 'All' as 'All' | 'Vendor', search: '', page: 1 } },
    );
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('c-all-none-1'));
    rerender({ type: 'Vendor', search: '', page: 1 });
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('c-Vendor-none-1'));
    rerender({ type: 'Vendor', search: 'volt', page: 3 });
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('c-Vendor-volt-3'));
    expect(h.listPage).toHaveBeenCalledTimes(3);
  });

  it('is disabled until an org is known', () => {
    h.orgId = undefined;
    renderHook(() => useCompaniesPage({ type: 'All', search: '', page: 1, pageSize: 50 }), {
      wrapper: wrapper(client()),
    });
    expect(h.listPage).not.toHaveBeenCalled();
  });

  it('keeps the previous page visible while a new one loads (placeholderData)', async () => {
    h.listPage.mockImplementation(
      ({ page }: { page: number }) =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ rows: [{ id: `p${page}` }], total: 120 }), 20),
        ),
    );
    const { result, rerender } = renderHook(
      (input: { page: number }) => useCompaniesPage({ type: 'All', search: '', pageSize: 50, ...input }),
      { wrapper: wrapper(client()), initialProps: { page: 1 } },
    );
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('p1'));
    rerender({ page: 2 });
    // still the OLD page's data while page 2 is in flight
    expect(result.current.data?.rows[0]?.id).toBe('p1');
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('p2'));
  });
});

describe('useCompaniesTotal', () => {
  it('reads the head count once per org', async () => {
    h.count.mockResolvedValue(21);
    const { result } = renderHook(() => useCompaniesTotal(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(21);
    expect(h.count).toHaveBeenCalledWith();
  });

  it('can be disabled (the directory only needs it while a filter/search is active)', () => {
    renderHook(() => useCompaniesTotal({ enabled: false }), { wrapper: wrapper(client()) });
    expect(h.count).not.toHaveBeenCalled();
  });
});

describe('useCompanyOptions', () => {
  it('reads the whole-directory display rows through the repository', async () => {
    h.listOptions.mockResolvedValue([{ id: 'c1', name: 'Atlas', short_name: null }]);
    const { result } = renderHook(() => useCompanyOptions(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listOptions).toHaveBeenCalledWith();
    expect(result.current.data?.[0]?.name).toBe('Atlas');
  });
});

describe('useCompaniesExportAll', () => {
  it('fetches the FULL matching set for the export', async () => {
    h.listAll.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const { result } = renderHook(() => useCompaniesExportAll(), { wrapper: wrapper(client()) });
    await result.current.mutateAsync({ type: 'Client', search: 'steel' });
    expect(h.listAll).toHaveBeenCalledWith({ type: 'Client', search: 'steel' });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });
});
