import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { tasksState } = vi.hoisted(() => ({
  tasksState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => tasksState,
  useMyTaskMutations: () => ({ updateStatus: { mutate: vi.fn(), isPending: false } }),
}));

import MyTasks from '../MyTasks';

const renderMyTasks = () => render(
  <ImpersonationProvider realRole="Engineer">
    <MemoryRouter>
      <ToastProvider>
        <MyTasks />
      </ToastProvider>
    </MemoryRouter>
  </ImpersonationProvider>,
);

beforeEach(() => {
  tasksState.data = [
    { id: 'oldest', project_id: 'p1', project_name: 'Alpha', name: 'Oldest task', status: 'To Do', start_date: null, end_date: '2024-01-01' },
    { id: 'second', project_id: 'p1', project_name: 'Alpha', name: 'Second task', status: 'In Progress', start_date: null, end_date: '2025-01-01' },
    { id: 'third', project_id: 'p1', project_name: 'Alpha', name: 'Third task', status: 'To Do', start_date: null, end_date: '2026-01-01' },
  ];
  tasksState.isPending = false;
  tasksState.isError = false;
});

describe('screen rules: My Tasks hierarchy and late emphasis', () => {
  it('uses a waiting surface with a key figure and one emphasized late row', () => {
    renderMyTasks();

    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open tasks' })).toHaveTextContent('Open');
    const waiting = screen.getByTestId('my-tasks-waiting-summary');
    expect(waiting).toHaveClass('bg-waiting-surface');
    expect(within(waiting).getByTestId('my-tasks-open-count')).toHaveClass('text-metric');
    expect(within(waiting).getByTestId('my-tasks-overdue-count')).toHaveClass('bg-status-danger-surface');
    expect(within(waiting).getByTestId('my-tasks-overdue-count')).toHaveTextContent('3');

    const lateRows = screen.getAllByTestId(/^my-task-late-status-/);
    expect(lateRows).toHaveLength(3);
    expect(lateRows.filter((row) => row.classList.contains('text-destructive-text'))).toHaveLength(1);
    expect(screen.getByTestId('my-task-late-status-second')).toHaveTextContent(/days late/);
    expect(screen.getByTestId('my-task-late-status-second')).not.toHaveTextContent(/overdue/);
  });
});
