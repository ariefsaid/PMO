import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * Unknown-as-zero audit F19: the open-task figure is a fact only once the task list has
 * loaded. While the read has not landed the page shows no count — never a fabricated 0
 * ("0 open tasks").
 */

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

const seed = [
  { id: 'a', name: 'Prepare the agenda', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
  { id: 'b', name: 'Review design specs', status: 'In Progress', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
  { id: 'c', name: 'Send last week notes', status: 'Done', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
];

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
  tasksState.data = seed;
  tasksState.isPending = false;
  tasksState.isError = false;
});

describe('F19 — the open-task count never prints while unknown', () => {
  it('while the task list has not loaded, the page shows no open-task count (never a fabricated 0)', () => {
    tasksState.data = null;
    renderMyTasks();
    expect(screen.queryByTestId('my-tasks-open-count')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('a loaded list prints the true open count (open tasks only)', () => {
    renderMyTasks();
    const figure = screen.getByTestId('my-tasks-open-count');
    expect(figure).toHaveTextContent('2');
    expect(figure).toHaveAccessibleName('2 Open tasks');
  });
});
