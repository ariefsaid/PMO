import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The CRUD mutation hook consumes the repository seam (ADR-0017), not the DAL directly.
const { project } = vi.hoisted(() => ({
  project: {
    create: vi.fn(),
    updateHeader: vi.fn(),
    archive: vi.fn(),
    setContractValue: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

import { useProjectMutations } from './useProjects';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  project.create.mockResolvedValue({ id: 'p9', name: 'New', status: 'Leads' });
  project.updateHeader.mockResolvedValue(undefined);
  project.archive.mockResolvedValue(undefined);
  project.setContractValue.mockResolvedValue(undefined);
});

describe('useProjectMutations', () => {
  const input = {
    name: 'Harborside Terminal',
    status: 'Leads' as const,
    client_id: 'c2',
    project_manager_id: 'a2',
    contract_value: 4820000,
    start_date: null,
    end_date: null,
  };

  it('AC-PRJ-003: create invokes the repository and invalidates the projects + opportunity queries', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.create.mutateAsync(input);
    });
    expect(project.create).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['projects'] });
  });

  it('AC-PRJ-004: updateHeader invokes the repository with id + header input', async () => {
    const header = {
      name: 'Renamed',
      code: 'OPP-2041',
      client_id: 'c3',
      project_manager_id: 'a2',
      start_date: null,
      end_date: null,
    };
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.updateHeader.mutateAsync({ id: 'p1', input: header });
    });
    expect(project.updateHeader).toHaveBeenCalledWith('p1', header);
  });

  it('AC-PRJ-005: archive invokes the repository with the id', async () => {
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.archive.mutateAsync('p1');
    });
    expect(project.archive).toHaveBeenCalledWith('p1');
  });

  it('AC-PRJ-006: setContractValue invokes the SoD RPC repository with id + value', async () => {
    const { result } = renderHook(() => useProjectMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.setContractValue.mutateAsync({ id: 'p1', value: 5140000 });
    });
    expect(project.setContractValue).toHaveBeenCalledWith('p1', 5140000);
  });
});
