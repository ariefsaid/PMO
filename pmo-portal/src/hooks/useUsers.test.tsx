import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hooks consume the repository seam (ADR-0017), not the DAL directly.
const { profile } = vi.hoisted(() => ({
  profile: {
    listUsers: vi.fn(),
    updateUserRole: vi.fn(),
    assignUserManager: vi.fn(),
    inviteUser: vi.fn(),
    setUserStatus: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { profile } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

import { useUsers, useUserMutations } from './useUsers';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seed = [
  { id: 'u1', full_name: 'Renata Halloway', email: 'r@x', role: 'Admin', manager_id: null, org_id: 'org-1' },
];

beforeEach(() => {
  profile.listUsers.mockResolvedValue(seed);
  profile.updateUserRole.mockResolvedValue(undefined);
  profile.assignUserManager.mockResolvedValue(undefined);
  profile.inviteUser.mockResolvedValue(undefined);
  profile.setUserStatus.mockResolvedValue(undefined);
});

describe('useUsers', () => {
  it("AC-AU-001: keys by ['users', orgId] and returns profile rows", async () => {
    const { result } = renderHook(() => useUsers(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].full_name).toBe('Renata Halloway');
    expect(profile.listUsers).toHaveBeenCalledTimes(1);
  });
});

describe('useUserMutations', () => {
  it('AC-AU-003: updateRole invokes the repository and invalidates the users query', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.updateRole.mutateAsync({ id: 'u2', role: 'Executive' });
    });
    expect(profile.updateUserRole).toHaveBeenCalledWith('u2', 'Executive');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] });
  });

  it('AC-AU-004: assignManager invokes the repository with id + managerId', async () => {
    const { result } = renderHook(() => useUserMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.assignManager.mutateAsync({ id: 'u3', managerId: 'mgr-1' });
    });
    expect(profile.assignUserManager).toHaveBeenCalledWith('u3', 'mgr-1');
  });

  it('AC-AU-004: assignManager passes null to clear the reporting line', async () => {
    const { result } = renderHook(() => useUserMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.assignManager.mutateAsync({ id: 'u3', managerId: null });
    });
    expect(profile.assignUserManager).toHaveBeenCalledWith('u3', null);
  });

  it('AC-INV-004: invite invokes the repository and invalidates the users query', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.invite.mutateAsync({ email: 'new@example.com', role: 'Engineer' });
    });
    expect(profile.inviteUser).toHaveBeenCalledWith({ email: 'new@example.com', role: 'Engineer' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] });
  });

  it('AC-OPR-003/AC-INV-004: setStatus invokes the repository and invalidates the users query', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.setStatus.mutateAsync({ id: 'u4', status: 'disabled', orgId: 'org-1' });
    });
    expect(profile.setUserStatus).toHaveBeenCalledWith({ id: 'u4', status: 'disabled', orgId: 'org-1' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] });
  });
});
