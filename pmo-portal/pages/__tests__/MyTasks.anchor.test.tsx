/**
 * AC-JR-T25: My-Tasks precise task targeting.
 *
 * Clicking a task name in MyTasks should deep-link to the task's anchor on the
 * Tasks tab: `/projects/:projectId/tasks#task-<taskId>`. This allows the TasksTab
 * to scroll to and highlight the specific task rather than landing generically
 * at the top of the tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { tasksState } = vi.hoisted(() => ({
  tasksState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => tasksState,
  useMyTaskMutations: () => ({
    updateStatus: { mutate: vi.fn(), isPending: false },
  }),
}));

import MyTasks from '../MyTasks';

const task1 = {
  id: 't-abc-123',
  name: 'Install panels',
  status: 'To Do',
  assignee_id: 'u-self',
  project_id: 'proj-xyz',
  project_name: 'Solar Site Alpha',
  start_date: null,
  end_date: null,
};

const task2 = {
  id: 't-def-456',
  name: 'Inspect foundations',
  status: 'In Progress',
  assignee_id: 'u-self',
  project_id: 'proj-xyz',
  project_name: 'Solar Site Alpha',
  start_date: null,
  end_date: '2026-07-15',
};

const renderMyTasks = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
        <ToastProvider>
          <MyTasks />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  tasksState.data = [task1, task2];
  tasksState.isPending = false;
  tasksState.isError = false;
  tasksState.refetch.mockClear();
});

describe('AC-JR-T25: MyTasks task name links carry #task-<id> anchor', () => {
  it('AC-JR-T25: task name link points to /projects/:projectId/tasks#task-<taskId>', () => {
    renderMyTasks();
    const link = screen.getByRole('link', { name: 'Install panels' });
    expect(link).toHaveAttribute('href', '/projects/proj-xyz/tasks#task-t-abc-123');
  });

  it('AC-JR-T25: each task name link carries its own anchor fragment', () => {
    renderMyTasks();
    const link1 = screen.getByRole('link', { name: 'Install panels' });
    const link2 = screen.getByRole('link', { name: 'Inspect foundations' });
    expect(link1).toHaveAttribute('href', '/projects/proj-xyz/tasks#task-t-abc-123');
    expect(link2).toHaveAttribute('href', '/projects/proj-xyz/tasks#task-t-def-456');
  });

  it('AC-JR-T25: project-header link still points to /projects/:projectId/tasks (no anchor)', () => {
    renderMyTasks();
    const projectLink = screen.getByRole('link', { name: 'Solar Site Alpha' });
    expect(projectLink).toHaveAttribute('href', '/projects/proj-xyz/tasks');
  });
});
