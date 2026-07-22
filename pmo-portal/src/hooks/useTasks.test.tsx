import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hooks consume the repository seam (ADR-0017), not the DAL directly.
const { task, profile } = vi.hoisted(() => ({
  task: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
  },
  profile: { listOrgProfiles: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task, profile } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useTasks, useTaskMutations, useAssignableProfiles } from './useTasks';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seed = [
  {
    id: 't1',
    project_id: 'p1',
    name: 'Survey site',
    status: 'To Do',
    assignee_id: 'u1',
    start_date: null,
    end_date: null,
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    assignee: { id: 'u1', full_name: 'Dana Eng' },
    dependencies: [],
  },
];

beforeEach(() => {
  task.list.mockResolvedValue(seed);
  task.create.mockResolvedValue({ ...seed[0], id: 't2', name: 'New task' });
  task.update.mockResolvedValue(undefined);
  task.updateStatus.mockResolvedValue(undefined);
  task.delete.mockResolvedValue(undefined);
  task.addDependency.mockResolvedValue(undefined);
  task.removeDependency.mockResolvedValue(undefined);
  profile.listOrgProfiles.mockResolvedValue([{ id: 'u1', full_name: 'Dana Eng', role: 'Engineer' }]);
});

describe('useTasks', () => {
  it("AC-TASK-001: keys by ['tasks', orgId, projectId] and returns task rows", async () => {
    const { result } = renderHook(() => useTasks('p1'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('Survey site');
    expect(task.list).toHaveBeenCalledWith('p1');
  });

  it('AC-TASK-001: is disabled (no fetch) without a projectId', async () => {
    task.list.mockClear();
    const { result } = renderHook(() => useTasks(''), { wrapper: wrap(freshClient()) });
    // enabled:false → stays idle, never fetches.
    expect(result.current.fetchStatus).toBe('idle');
    expect(task.list).not.toHaveBeenCalled();
  });
});

describe('useAssignableProfiles', () => {
  it('AC-TASK-008: returns the org profiles for the assignee picker', async () => {
    const { result } = renderHook(() => useAssignableProfiles(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].full_name).toBe('Dana Eng');
    expect(profile.listOrgProfiles).toHaveBeenCalledTimes(1);
  });
});

describe('useTaskMutations', () => {
  it('AC-TASK-003: create invokes the repository and invalidates the tasks query', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTaskMutations('p1'), { wrapper: wrap(client) });
    const input = { project_id: 'p1', name: 'New task', status: 'To Do' as const, assignee_id: 'u1' };
    await act(async () => {
      await result.current.create.mutateAsync(input);
    });
    expect(task.create).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 'org-1', 'p1'] });
  });

  it('AC-TASK-004: update invokes the repository with id + patch', async () => {
    const { result } = renderHook(() => useTaskMutations('p1'), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.update.mutateAsync({ id: 't1', patch: { name: 'X' } });
    });
    expect(task.update).toHaveBeenCalledWith('t1', { name: 'X' }, 'p1');
  });

  it('AC-TASK-005: updateStatus invokes the repository with id + status', async () => {
    const { result } = renderHook(() => useTaskMutations('p1'), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.updateStatus.mutateAsync({ id: 't1', status: 'Done' });
    });
    expect(task.updateStatus).toHaveBeenCalledWith('t1', 'Done', 'p1');
  });

  it('AC-TASK-006: remove invokes the repository delete with the id', async () => {
    const { result } = renderHook(() => useTaskMutations('p1'), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.remove.mutateAsync('t1');
    });
    expect(task.delete).toHaveBeenCalledWith('t1', 'p1');
  });

  it('AC-TASK-007: addDependency / removeDependency invoke the repository', async () => {
    const { result } = renderHook(() => useTaskMutations('p1'), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.addDependency.mutateAsync({ taskId: 't2', dependsOnId: 't1' });
    });
    expect(task.addDependency).toHaveBeenCalledWith('t2', 't1');
    await act(async () => {
      await result.current.removeDependency.mutateAsync({ taskId: 't2', dependsOnId: 't1' });
    });
    expect(task.removeDependency).toHaveBeenCalledWith('t2', 't1');
  });
});
