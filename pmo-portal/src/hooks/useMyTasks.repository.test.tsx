import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
const task = vi.hoisted(() => ({ listByAssignee: vi.fn(), updateStatus: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
import { useMyTasks, useMyTaskMutations } from './useMyTasks';
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
describe('My Tasks repository', () => {
  it('reads the assignee list through the repository', async () => {
    task.listByAssignee.mockResolvedValue([{ id: 't1', project_name: 'Project' }]);
    const { result } = renderHook(() => useMyTasks(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(task.listByAssignee).toHaveBeenCalledWith('u1');
    expect(result.current.data?.[0].project_name).toBe('Project');
  });
  it('surfaces an assignee read error', async () => {
    task.listByAssignee.mockRejectedValueOnce(new Error('read failed'));
    const { result } = renderHook(() => useMyTasks(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('read failed');
  });
  it('refreshes project, assignee and meeting caches for the current organization', async () => {
    task.updateStatus.mockResolvedValue(undefined);
    const client = new QueryClient();
    const keys = [['tasks', 'org-1', 'p1'], ['milestones', 'org-1', 'p1'], ['my-tasks', 'org-1', 'u1'], ['meeting-action-items', 'org-1', 'm1'], ['projects-delivery', 'pct', 'org-1', 'p1']];
    for (const key of keys) client.setQueryData(key, 'old');
    const { result } = renderHook(() => useMyTaskMutations(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await act(async () => { await result.current.updateStatus.mutateAsync({ id: 't1', status: 'Done', projectId: 'p1' }); });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
  it('propagates status write errors from the repository', async () => {
    task.updateStatus.mockRejectedValue(new Error('write failed'));
    const { result } = renderHook(() => useMyTaskMutations(), { wrapper });
    await act(async () => { await expect(result.current.updateStatus.mutateAsync({ id: 't1', status: 'Done', projectId: 'p1' })).rejects.toThrow('write failed'); });
    expect(task.updateStatus).toHaveBeenCalledWith('t1', 'Done', 'p1');
  });
});
