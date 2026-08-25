import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { repoMock } = vi.hoisted(() => ({
  repoMock: {
    meeting: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
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

import { useMeetings, useMeetingMutations } from './useMeetings';

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
  it('passes the project filter + search through to the repository (server-side, DD-MTG-5)', async () => {
    repoMock.meeting.list.mockResolvedValue([]);
    const { result } = renderHook(
      () => useMeetings({ projectId: 'p1', search: 'pipeline' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(repoMock.meeting.list).toHaveBeenCalledWith({ projectId: 'p1', search: 'pipeline' });
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
    });
    expect(repoMock.task.create).toHaveBeenCalledWith({
      project_id: 'p1',
      name: 'Order the flange samples',
      status: 'To Do',
      assignee_id: null,
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
    });
    expect(repoMock.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: null, meeting_id: 'm2' }),
    );
  });
});
