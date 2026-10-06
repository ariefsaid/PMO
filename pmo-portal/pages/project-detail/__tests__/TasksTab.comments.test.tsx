/**
 * AC-CMT-001 — a reader of a task who cannot edit it (Engineer on someone else's task) still sees and
 * posts task comments, from a read view (not the edit form).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { listState, profilesState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  profilesState: { data: [] as unknown[], isPending: false, isError: false },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => listState,
  useAssignableProfiles: () => profilesState,
  useTaskMutations: () => mutations,
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));

const list = vi.fn();
const create = vi.fn();
vi.mock('@/src/lib/db/comments', () => ({
  listComments: (...a: unknown[]) => list(...a),
  createComment: (...a: unknown[]) => create(...a),
  archiveComment: vi.fn(),
}));

import TasksTab from '../tabs/TasksTab';

const profiles = [
  { id: 'eng-1', full_name: 'Dana Engineer', role: 'Engineer' },
  { id: 'pm-1', full_name: 'Pat Manager', role: 'Project Manager' },
];

const seed = [
  {
    id: 't1',
    project_id: 'p1',
    name: 'Survey the site',
    status: 'To Do',
    assignee_id: 'eng-1',
    start_date: null,
    end_date: '2026-06-20',
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    assignee: { id: 'eng-1', full_name: 'Dana Engineer' },
    dependencies: [],
  },
];

const renderTab = (role: Role, userId: string) => {
  realRole = role;
  currentUserId = userId;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/tasks']}>
        <ToastProvider>
          <TasksTab projectId="p1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('TasksTab comments for a non-editor reader', () => {
  beforeEach(() => {
    listState.data = seed;
    profilesState.data = profiles;
    list.mockReset().mockResolvedValue([
      { id: 'c1', author_id: 'eng-1', body: 'Blocked on a drawing', created_at: new Date().toISOString(), author: { id: 'eng-1', full_name: 'Dana Engineer' } },
    ]);
    create.mockReset().mockResolvedValue(undefined);
  });

  it('AC-CMT-001 an Engineer who cannot edit the task opens its comments, reads and posts', async () => {
    const user = userEvent.setup();
    renderTab('Engineer', 'eng-2');
    expect(screen.queryByRole('button', { name: 'Edit Survey the site' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Comments Survey the site' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Blocked on a drawing')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox'), 'Noted');
    await user.click(within(dialog).getByRole('button', { name: 'Post comment' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ entityType: 'task', entityId: 't1', body: 'Noted', mentions: [] }),
    );
  });
});
