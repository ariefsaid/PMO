import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  orgId: 'org-A' as string | null,
  role: 'Finance',
  getProjectFinances: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.orgId ? { id: 'user', org_id: h.orgId } : null }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => ['Admin', 'Finance', 'Executive', 'Project Manager'].includes(h.role) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: { getProjectFinances: h.getProjectFinances } } }));

import { useProjectFinances } from './useProjectFinances';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, Wrapper };
}

describe('useProjectFinances', () => {
  beforeEach(() => {
    h.orgId = 'org-A';
    h.role = 'Finance';
    h.getProjectFinances.mockReset();
    h.getProjectFinances.mockImplementation(async (projectId: string) => ({ project_id: projectId }));
  });

  it.each(['Admin', 'Finance', 'Executive', 'Project Manager'])('AC-PFIN-019 %s can read only an org/project-keyed finance query', async (role) => {
    h.role = role;
    const { client, Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectFinances('project-A'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.getProjectFinances).toHaveBeenCalledExactlyOnceWith('project-A');
    expect(client.getQueryData(['project-finances', 'org-A', 'project-A'])).toEqual({ project_id: 'project-A' });
  });

  it.each([
    { role: 'Engineer', orgId: 'org-A', projectId: 'project-A' },
    { role: 'Finance', orgId: null, projectId: 'project-A' },
    { role: 'Finance', orgId: 'org-A', projectId: '' },
  ])('AC-PFIN-019 disables reads for denied or incomplete context %o', ({ role, orgId, projectId }) => {
    h.role = role;
    h.orgId = orgId;
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useProjectFinances(projectId), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.getProjectFinances).not.toHaveBeenCalled();
  });

  it('AC-PFIN-019 does not reuse finance data across org keys', async () => {
    const { client, Wrapper } = makeWrapper();
    h.getProjectFinances.mockImplementation(async (projectId: string) => ({ project_id: projectId, org: h.orgId }));
    const { result: orgA } = renderHook(() => useProjectFinances('project-A'), { wrapper: Wrapper });
    await waitFor(() => expect(orgA.current.isSuccess).toBe(true));
    h.orgId = 'org-B';
    const { result: orgB } = renderHook(() => useProjectFinances('project-A'), { wrapper: Wrapper });
    await waitFor(() => expect(orgB.current.isSuccess).toBe(true));
    expect(h.getProjectFinances).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(['project-finances', 'org-A', 'project-A'])).toEqual({ project_id: 'project-A', org: 'org-A' });
    expect(client.getQueryData(['project-finances', 'org-B', 'project-A'])).toEqual({ project_id: 'project-A', org: 'org-B' });
  });
});
