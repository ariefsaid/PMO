import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { repoMock } = vi.hoisted(() => ({
  repoMock: {
    meeting: {
      list: vi.fn(),
      listPage: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      delete: vi.fn(),
      listAttendees: vi.fn(),
      addAttendee: vi.fn(),
      removeAttendee: vi.fn(),
      listGrants: vi.fn(),
      addGrant: vi.fn(),
      revokeGrant: vi.fn(),
    },
    task: {
      create: vi.fn(),
      listByMeeting: vi.fn(),
    },
  },
}));

vi.mock('@/src/lib/repositories', () => ({ repositories: repoMock }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

import { useMeetings, useMeetingsPages, useMeetingMutations } from './useMeetings';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  Object.values(repoMock.meeting).forEach((f) => f.mockReset());
  Object.values(repoMock.task).forEach((f) => f.mockReset());
});

describe('useMeetings', () => {
  it('C8 meetings.ts:84,168,196 loads the next page at the number of rows already shown', async () => {
    repoMock.meeting.listPage
      .mockResolvedValueOnce({ rows: Array.from({ length: 25 }, (_, i) => ({ id: `m${i}` })), hasMore: true })
      .mockResolvedValueOnce({ rows: [{ id: 'm25' }], hasMore: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stableWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMeetingsPages({ projectId: 'p1' }), { wrapper: stableWrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(repoMock.meeting.listPage).toHaveBeenNthCalledWith(1, { projectId: 'p1' }, 0);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(repoMock.meeting.listPage).toHaveBeenNthCalledWith(2, { projectId: 'p1' }, 25);
    expect(result.current.data?.pages.flatMap((page) => page.rows.map((row) => row.id))).toHaveLength(26);
  });

  it('passes the project filter + search through to the repository (server-side, DD-MTG-5)', async () => {
    repoMock.meeting.list.mockResolvedValue([]);
    const { result } = renderHook(
      () => useMeetings({ projectId: 'p1', search: 'pipeline' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(repoMock.meeting.list).toHaveBeenCalledWith({ projectId: 'p1', search: 'pipeline' });
  });

  it('requests the full set, including archived rows, through a distinct repository query', async () => {
    repoMock.meeting.list.mockResolvedValue([]);
    const { result } = renderHook(() => useMeetings({ includeArchived: true }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(repoMock.meeting.list).toHaveBeenCalledWith({ includeArchived: true });
  });
});

describe('useMeetingMutations.restore', () => {
  it('restores through the repository and invalidates meeting queries', async () => {
    repoMock.meeting.restore.mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['meetings', 'org-1', 'all', '', 'archived'], ['stale']);
    client.setQueryData(['meetings-pages', 'org-1', 'all', '', 'archived'], { pages: [{ rows: ['stale'], hasMore: false }] });
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMeetingMutations(), { wrapper: localWrapper });

    await result.current.restore.mutateAsync('m1');

    expect(repoMock.meeting.restore).toHaveBeenCalledWith('m1');
    expect(client.getQueryState(['meetings', 'org-1', 'all', '', 'archived'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['meetings-pages', 'org-1', 'all', '', 'archived'])?.isInvalidated).toBe(true);
  });
});

describe('useMeetingMutations.createActionItem — the /action seam (FR-MTG-017 / DD-MTG-2)', () => {
  it('creates the task through the SAME task repository path, with meeting_id + the meeting’s project', async () => {
    repoMock.task.create.mockResolvedValue({ id: 't1' });
    const { result } = renderHook(() => useMeetingMutations(), { wrapper });
    await result.current.createActionItem.mutateAsync({
      meetingId: 'm1',
      projectId: 'p1',
      name: 'Order the flange samples',
      assigneeId: 'user-2',
      endDate: '2026-10-20',
    });
    expect(repoMock.task.create).toHaveBeenCalledWith({
      project_id: 'p1',
      name: 'Order the flange samples',
      status: 'To Do',
      assignee_id: 'user-2',
      end_date: '2026-10-20',
      meeting_id: 'm1',
    });
  });

  it('a project-less meeting creates a project-less task (DD-TASK-1 — legal, never an error)', async () => {
    repoMock.task.create.mockResolvedValue({ id: 't2' });
    const { result } = renderHook(() => useMeetingMutations(), { wrapper });
    await result.current.createActionItem.mutateAsync({
      meetingId: 'm2',
      projectId: null,
      name: 'Follow up',
      assigneeId: null,
      endDate: null,
    });
    expect(repoMock.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: null, meeting_id: 'm2' }),
    );
  });

  it('invalidates the action-item list AND the task lists (a /action task is a real task)', async () => {
    repoMock.task.create.mockResolvedValue({ id: 't3' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const keysBefore = [['meeting-action-items', 'org-1', 'm1'], ['tasks', 'org-1', 'p1'], ['my-tasks', 'org-1', 'u1'], ['projects-delivery', 'pct', 'org-1', 'p1']];
    for (const key of keysBefore) client.setQueryData(key, 'old');
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMeetingMutations(), { wrapper: localWrapper });
    await result.current.createActionItem.mutateAsync({
      meetingId: 'm1',
      projectId: 'p1',
      name: 'Chase samples',
      assigneeId: null,
      endDate: null,
    });
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown[] }).queryKey?.[0]);
    expect(keys).toContain('meeting-action-items');
    expect(keys).toContain('tasks'); // project Tasks tab cache
    expect(keys).toContain('my-tasks'); // the IC's cross-project list cache
    for (const key of keysBefore) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
