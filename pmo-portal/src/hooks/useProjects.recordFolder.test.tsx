// @vitest-environment jsdom
/**
 * AC-M365DOC-071 successful project creation survives every folder failure — the SHIPPED
 * `useProjectMutations().create` hook starts the folder step after the real INSERT.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui/Toast';
import type { Role } from '@/src/auth/AuthContext';

const { project, integrations, m365RecordFolders, order } = vi.hoisted(() => ({
  order: [] as string[],
  integrations: { getBinding: vi.fn() },
  project: { create: vi.fn(), updateHeader: vi.fn(), archive: vi.fn(), delete: vi.fn(), setContractValue: vi.fn() },
  m365RecordFolders: { ensure: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project, integrations, m365RecordFolders } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProjectMutations } from './useProjects';

const input = {
  name: 'Synthetic project', status: 'Leads' as const, client_id: 'c1', project_manager_id: null,
  contract_value: 0, start_date: null, end_date: null,
};
let qc: QueryClient;
const wrapper = (role: Role = 'Project Manager') =>
  function W({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ImpersonationProvider realRole={role}><ToastProvider>{children}</ToastProvider></ImpersonationProvider>
      </QueryClientProvider>
    );
  };

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  project.create.mockImplementation(async () => { order.push('insert'); return { id: 'p9', name: 'Synthetic project' }; });
  integrations.getBinding.mockImplementation(async () => { order.push('erp'); return null; });
  m365RecordFolders.ensure.mockImplementation(() => { order.push('folder'); return new Promise(() => {}); });
});

describe('AC-M365DOC-071 create-project wiring', () => {
  it('starts the folder step once, after the INSERT and before ERP setup, and a never-settling folder cannot delay the save', async () => {
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrapper() });
    let saved: { id: string; erpSetup?: string } | undefined;
    await act(async () => { saved = await result.current.create.mutateAsync(input); });
    expect(order).toEqual(['insert', 'folder', 'erp']);
    expect(m365RecordFolders.ensure).toHaveBeenCalledTimes(1);
    expect(m365RecordFolders.ensure).toHaveBeenCalledWith({ kind: 'project', id: 'p9' });
    expect(saved).toMatchObject({ id: 'p9' });
    expect(saved).toHaveProperty('erpSetup');
  });

  it('keeps every original invalidation', async () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrapper() });
    await act(async () => { await result.current.create.mutateAsync(input); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['projects'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['sales-pipeline'] });
  });

  it.each([
    ['rejects', () => Promise.reject(Object.assign(new Error('RAW'), { code: 'GRAPH_ERROR' }))],
    ['throws synchronously', () => { throw new Error('RAW'); }],
  ])('a folder ensure that %s still returns the saved project', async (_n, impl) => {
    m365RecordFolders.ensure.mockImplementation(impl);
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrapper() });
    let saved: { id: string } | undefined;
    await act(async () => { saved = await result.current.create.mutateAsync(input); });
    expect(saved?.id).toBe('p9');
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
  });

  it('a failed project INSERT starts nothing', async () => {
    project.create.mockRejectedValueOnce(new Error('insert failed'));
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrapper() });
    await act(async () => { await result.current.create.mutateAsync(input).catch(() => undefined); });
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });

  it('a non-writer saves the project but starts no folder', async () => {
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrapper('Engineer') });
    await act(async () => { await result.current.create.mutateAsync(input); });
    expect(project.create).toHaveBeenCalledTimes(1);
    expect(m365RecordFolders.ensure).not.toHaveBeenCalled();
  });
});
