import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The directory's query keys are the isolation seam: page, page size and search are part of the
 * key (plus org), so a response for an OLD page/search can never be served as the new one, and a
 * tenant switch cannot reuse another org's page.
 */
const h = vi.hoisted(() => ({
  listUsersPage: vi.fn(),
  countActiveAdminsByOrg: vi.fn(),
  findUserPage: vi.fn(),
  listManagerChoices: vi.fn(),
  orgId: 'org-1' as string | undefined,
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    profile: {
      listUsersPage: (...args: unknown[]) => h.listUsersPage(...args),
      countActiveAdminsByOrg: (...args: unknown[]) => h.countActiveAdminsByOrg(...args),
      findUserPage: (...args: unknown[]) => h.findUserPage(...args),
      listManagerChoices: (...args: unknown[]) => h.listManagerChoices(...args),
    },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.orgId ? { id: 'u-me', org_id: h.orgId } : null }),
}));

import { useActiveAdminCounts, useManagerChoices, useUserFocusPage, useUsersPage } from './useUsers';

const wrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  h.listUsersPage.mockReset();
  h.countActiveAdminsByOrg.mockReset();
  h.findUserPage.mockReset();
  h.listManagerChoices.mockReset();
  h.orgId = 'org-1';
});

describe('useUsersPage cache isolation', () => {
  it('a page change is a DIFFERENT cache entry — the old page can never be served as the new one', async () => {
    h.listUsersPage.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve({ rows: [{ id: `u-p${page}` }], total: 120 }),
    );
    const qc = client();
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useUsersPage({ page, pageSize: 50, search: '' }),
      { wrapper: wrapper(qc), initialProps: { page: 1 } },
    );
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('u-p1'));

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe('u-p2'));

    const keys = qc.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(['users', 'org-1', 'page', 1, 50, '']);
    expect(keys).toContainEqual(['users', 'org-1', 'page', 2, 50, '']);
    expect(h.listUsersPage).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: '' });
    expect(h.listUsersPage).toHaveBeenCalledWith({ page: 2, pageSize: 50, search: '' });
  });

  it('a search change is its own entry (term included in the key)', async () => {
    h.listUsersPage.mockResolvedValue({ rows: [], total: 0 });
    const qc = client();
    const { rerender } = renderHook(
      ({ search }: { search: string }) => useUsersPage({ page: 1, pageSize: 50, search }),
      { wrapper: wrapper(qc), initialProps: { search: '' } },
    );
    await waitFor(() => expect(h.listUsersPage).toHaveBeenCalledTimes(1));
    rerender({ search: 'ada' });
    await waitFor(() => expect(h.listUsersPage).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'ada' }));
    expect(qc.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual(['users', 'org-1', 'page', 1, 50, 'ada']);
  });

  it('is disabled without an org (no unscoped directory read)', () => {
    h.orgId = undefined;
    const qc = client();
    renderHook(() => useUsersPage({ page: 1, pageSize: 50 }), { wrapper: wrapper(qc) });
    expect(h.listUsersPage).not.toHaveBeenCalled();
  });
});

describe('useActiveAdminCounts', () => {
  it('keys the sorted DISTINCT org set and preserves an unresolved (null) count', async () => {
    h.countActiveAdminsByOrg.mockResolvedValue({ 'org-1': null });
    const qc = client();
    const { result } = renderHook(() => useActiveAdminCounts(['org-1', 'org-1']), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data).toEqual({ 'org-1': null }));
    expect(h.countActiveAdminsByOrg).toHaveBeenCalledWith(['org-1']);
    expect(qc.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual([
      'users', 'org-1', 'active-admin-counts', ['org-1'],
    ]);
  });
});

describe('useManagerChoices', () => {
  it('reads NOTHING while the picker is closed, then the complete minimal set once it opens', async () => {
    h.listManagerChoices.mockResolvedValue([{ id: 'u-1', full_name: 'Ada', role: 'Engineer' }]);
    const qc = client();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useManagerChoices({ enabled }),
      { wrapper: wrapper(qc), initialProps: { enabled: false } },
    );
    expect(h.listManagerChoices).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data?.[0]?.id).toBe('u-1'));
    expect(h.listManagerChoices).toHaveBeenCalledTimes(1);
    expect(qc.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual([
      'users', 'org-1', 'manager-choices',
    ]);
  });
});

describe('useUserFocusPage', () => {
  it('stays disabled until a focus target exists, then resolves that person only', async () => {
    h.findUserPage.mockResolvedValue({ page: 2, email: 'a@x', full_name: 'A' });
    const qc = client();
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useUserFocusPage(userId, 50),
      { wrapper: wrapper(qc), initialProps: { userId: null as string | null } },
    );
    expect(h.findUserPage).not.toHaveBeenCalled();
    rerender({ userId: 'u-9' });
    await waitFor(() => expect(result.current.data?.page).toBe(2));
    expect(h.findUserPage).toHaveBeenCalledWith({ userId: 'u-9', pageSize: 50 });
  });
});
