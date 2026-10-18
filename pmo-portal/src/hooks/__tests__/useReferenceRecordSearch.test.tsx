import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/src/auth/AuthContext';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';

const state = vi.hoisted(() => ({
  currentUser: { id: 'user-1', org_id: 'org-1' } as { id?: string; org_id?: string } | null,
  search: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: state.currentUser }),
}));

vi.mock('@/src/lib/repositories/recordReferenceSearch', () => ({
  searchRecordReferencesRepository: state.search,
}));

import { useReferenceRecordSearch } from '../useReferenceRecordSearch';

const page = (id: string) => ({
  items: [{
    kind: 'invoice' as const,
    id,
    title: `Invoice ${id}`,
    context: null,
    reference: 'SI-420',
    aliases: ['SI-420'],
    exact: true,
  }],
  hasMore: false,
});

function wrapperFor(realRole: Role | null, demo = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ImpersonationProvider realRole={realRole} demoEligibility={demo ? 'eligible' : 'ineligible'}>
          {children}
        </ImpersonationProvider>
      </QueryClientProvider>
    );
  };
}

describe('useReferenceRecordSearch', () => {
  beforeEach(() => {
    state.currentUser = { id: 'user-1', org_id: 'org-1' };
    state.search.mockReset();
    state.search.mockResolvedValue(page('invoice-1'));
  });

  it('AC-S40-002: stays idle until an open palette has a two-character query', async () => {
    const { result, rerender } = renderHook(
      ({ query, enabled }) => useReferenceRecordSearch(query, { enabled }),
      {
        initialProps: { query: '', enabled: false },
        wrapper: wrapperFor('Admin'),
      },
    );

    expect(result.current.fetchStatus).toBe('idle');
    rerender({ query: '  ', enabled: true });
    expect(result.current.fetchStatus).toBe('idle');
    rerender({ query: 'a', enabled: true });
    expect(result.current.fetchStatus).toBe('idle');
    rerender({ query: `${'a'.repeat(121)}`, enabled: true });
    expect(result.current.fetchStatus).toBe('idle');
    rerender({ query: 'SI-420', enabled: false });
    expect(result.current.fetchStatus).toBe('idle');
    expect(state.search).not.toHaveBeenCalled();

    rerender({ query: '  SI-420  ', enabled: true });
    await waitFor(() => expect(state.search).toHaveBeenCalledWith('si-420'));
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
  });

  it('AC-S40-002: requires the real revenue-view role, organization, and user', () => {
    const disabledCases: Array<{ role: Role | null; user: typeof state.currentUser }> = [
      { role: 'Engineer', user: { id: 'user-1', org_id: 'org-1' } },
      { role: 'Admin', user: { id: 'user-1' } },
      { role: 'Admin', user: { org_id: 'org-1' } },
      { role: null, user: { id: 'user-1', org_id: 'org-1' } },
    ];

    for (const { role, user } of disabledCases) {
      state.currentUser = user;
      const { result, unmount } = renderHook(
        () => useReferenceRecordSearch('si-420', { enabled: true }),
        { wrapper: wrapperFor(role) },
      );
      expect(result.current.fetchStatus).toBe('idle');
      unmount();
    }

    expect(state.search).not.toHaveBeenCalled();
  });

  it('AC-S40-002: keeps access based on the real role while viewing as another role', async () => {
    const ViewAsEngineer = ({ children }: { children: React.ReactNode }) => {
      const { viewAs } = useEffectiveRole();
      React.useEffect(() => viewAs('Engineer'), [viewAs]);
      return <>{children}</>;
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ImpersonationProvider realRole="Admin" demoEligibility="eligible">
          <ViewAsEngineer>{children}</ViewAsEngineer>
        </ImpersonationProvider>
      </QueryClientProvider>
    );

    renderHook(() => useReferenceRecordSearch('si-420', { enabled: true }), { wrapper });
    await waitFor(() => expect(state.search).toHaveBeenCalledWith('si-420'));
  });

  it('AC-S40-002: scopes cache identity to query, organization, and user without retaining old results', async () => {
    let resolveFirst: ((value: ReturnType<typeof page>) => void) | undefined;
    let resolveSecond: ((value: ReturnType<typeof page>) => void) | undefined;
    state.search.mockImplementation((query: string) => new Promise((resolve) => {
      if (query === 'first') resolveFirst = resolve;
      if (query === 'second') resolveSecond = resolve;
    }));

    const { result, rerender } = renderHook(
      ({ query }) => useReferenceRecordSearch(query, { enabled: true }),
      { initialProps: { query: 'first' }, wrapper: wrapperFor('Admin') },
    );
    await waitFor(() => expect(state.search).toHaveBeenCalledWith('first'));
    await act(async () => resolveFirst?.(page('first-result')));
    await waitFor(() => expect(result.current.data?.items[0]?.id).toBe('first-result'));

    rerender({ query: 'second' });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(state.search).toHaveBeenCalledWith('second'));
    await act(async () => resolveSecond?.(page('second-result')));
    await waitFor(() => expect(result.current.data?.items[0]?.id).toBe('second-result'));
    await act(async () => resolveFirst?.(page('late-first-result')));
    expect(result.current.data?.items[0]?.id).toBe('second-result');

    state.currentUser = { id: 'user-2', org_id: 'org-2' };
    rerender({ query: 'second' });
    await waitFor(() => expect(state.search).toHaveBeenCalledTimes(3));
  });

  it('AC-S40-002: refetch retries the same bounded query on demand without automatic retries', async () => {
    const { result } = renderHook(
      () => useReferenceRecordSearch('SI-420', { enabled: true }),
      { wrapper: wrapperFor('Finance') },
    );
    await waitFor(() => expect(state.search).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.refetch(); });
    expect(state.search).toHaveBeenCalledTimes(2);
    expect(state.search).toHaveBeenNthCalledWith(1, 'si-420');
    expect(state.search).toHaveBeenNthCalledWith(2, 'si-420');
  });
});
