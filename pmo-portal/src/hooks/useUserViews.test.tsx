import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hooks consume the repository seam (ADR-0017), not the DAL directly.
const { userView } = vi.hoisted(() => ({
  userView: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { userView } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

import { useUserViews, useUserView, useUserViewMutations } from './useUserViews';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seed = [
  { id: 'v1', name: 'My Board', scope: 'private', org_id: 'org-1', user_id: 'u1', spec: {}, archived_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  userView.list.mockResolvedValue(seed);
  userView.get.mockResolvedValue(seed[0]);
  userView.create.mockResolvedValue({ ...seed[0], id: 'v2', name: 'New View' });
  userView.update.mockResolvedValue(undefined);
  userView.archive.mockResolvedValue(undefined);
  userView.delete.mockResolvedValue(undefined);
});

describe('useUserViews', () => {
  it("AC-UV-008: keys by ['user_views', orgId] and returns view rows", async () => {
    const client = freshClient();
    const { result } = renderHook(() => useUserViews(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('My Board');
    expect(userView.list).toHaveBeenCalledTimes(1);
    // the list query is cached under the org-scoped key
    expect(client.getQueryData(['user_views', 'org-1'])).toEqual(seed);
  });
});

describe('useUserView (single record)', () => {
  it("AC-UV-008: keys by ['user_view', orgId, id] and returns the single view via repository.get", async () => {
    const client = freshClient();
    const { result } = renderHook(() => useUserView('v1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('My Board');
    expect(userView.get).toHaveBeenCalledWith('v1');
    expect(client.getQueryData(['user_view', 'org-1', 'v1'])).toEqual(seed[0]);
  });

  it('AC-UV-008: stays disabled (no fetch) when the id is undefined', () => {
    userView.get.mockClear();
    const { result } = renderHook(() => useUserView(undefined), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(userView.get).not.toHaveBeenCalled();
  });
});

describe('useUserViewMutations', () => {
  it('AC-UV-008: create invokes the repository and invalidates both view query families', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserViewMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.create.mutateAsync({ name: 'New View', spec: { k: 1 }, scope: 'private' });
    });
    expect(userView.create).toHaveBeenCalledWith({ name: 'New View', spec: { k: 1 }, scope: 'private' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_views'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_view'] });
  });

  it('AC-UV-008: update invokes the repository with id + input and invalidates', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserViewMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.update.mutateAsync({ id: 'v1', input: { name: 'X', spec: {} } });
    });
    expect(userView.update).toHaveBeenCalledWith('v1', { name: 'X', spec: {} });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_views'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_view'] });
  });

  it('AC-UV-008: archive invokes the repository with the id and invalidates', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserViewMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.archive.mutateAsync('v1');
    });
    expect(userView.archive).toHaveBeenCalledWith('v1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_views'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_view'] });
  });

  it('AC-UV-008: delete invokes the repository with the id and invalidates', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserViewMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.remove.mutateAsync('v1');
    });
    expect(userView.delete).toHaveBeenCalledWith('v1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_views'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user_view'] });
  });
});
