import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { recordLabelForPath } from '@/src/components/shell/routeMatch';

const { dal } = vi.hoisted(() => ({
  dal: {
    listProjects: vi.fn(async () => []),
    listProcurements: vi.fn(async () => []),
    getSalesPipeline: vi.fn(async () => ({ projects: [] })),
    list: vi.fn(async () => []),
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/db/projects', () => ({ listProjects: dal.listProjects }));
vi.mock('@/src/lib/db/procurements', () => ({ listProcurements: dal.listProcurements }));
vi.mock('@/src/lib/db/dashboard', () => ({ getSalesPipeline: dal.getSalesPipeline }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { company: dal, contact: dal, incident: dal, meeting: dal, project: dal },
}));

import { useCachedRecordLists } from './useCachedRecordLists';

function setup(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useCachedRecordLists(path), { wrapper }) };
}

describe('AC-OVERFETCH-001 shell breadcrumb reads the cache and never triggers a list fetch', () => {
  it.each(['/projects/p1', '/procurement/pr1', '/companies/c1', '/contacts/k1', '/incidents/i1', '/meetings/m1', '/views/v1'])(
    'mounting on %s with an empty cache fires no list query',
    (path) => {
      const { qc } = setup(path);
      expect(qc.isFetching()).toBe(0);
      for (const fn of Object.values(dal)) expect(fn).not.toHaveBeenCalled();
    },
  );

  it('shows an unresolved crumb on a cold deep link, then the name once the page\'s own detail query lands', async () => {
    const { qc, result } = setup('/projects/p1');
    expect(recordLabelForPath('/projects/p1', result.current.lists)).toBeUndefined();
    expect(result.current.resolved).toBe(false);
    act(() => {
      qc.setQueryData(['project', 'org-1', 'p1'], { id: 'p1', name: 'Harbour Fit-Out', status: 'Ongoing Project' });
    });
    await waitFor(() =>
      expect(recordLabelForPath('/projects/p1', result.current.lists)).toBe('Harbour Fit-Out'),
    );
    expect(result.current.resolved).toBe(true);
  });

  it('resolves a not-found detail (settled with no record) so the crumb stops saying Loading', async () => {
    const { qc, result } = setup('/projects/p2');
    act(() => {
      qc.setQueryData(['project', 'org-1', 'p2'], null);
    });
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(recordLabelForPath('/projects/p2', result.current.lists)).toBeUndefined();
  });

  it('uses an already-cached index list without fetching', () => {
    const qc = new QueryClient();
    qc.setQueryData(['companies', 'org-1', 'all'], [{ id: 'c1', name: 'Acme' }]);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCachedRecordLists('/companies/c1'), { wrapper });
    expect(recordLabelForPath('/companies/c1', result.current.lists)).toBe('Acme');
    expect(result.current.resolved).toBe(true);
    expect(dal.list).not.toHaveBeenCalled();
  });
});

describe('AC-OVERFETCH-001 the passive cache read never poisons the page\'s own query', () => {
  it('a page observer on the same key still refetches successfully after invalidation while the shell reader is mounted', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const pageFn = vi.fn(async () => [{ id: 'p1' }]);
    const { result } = renderHook(
      () => ({
        shell: useCachedRecordLists('/projects/p1'),
        page: useQuery({ queryKey: ['projects', 'org-1'], queryFn: pageFn }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.page.status).toBe('success'));
    expect(pageFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['projects', 'org-1'] });
    });
    expect(pageFn).toHaveBeenCalledTimes(2);
    expect(result.current.page.status).toBe('success');
    expect(result.current.page.error).toBeNull();
    expect(result.current.shell.lists.projects).toEqual([{ id: 'p1' }]);
  });
});
