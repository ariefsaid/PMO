import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * B-1 (AC-W2-IXD-002): My Tasks page component states.
 * Loading, empty, error, and populated states render correctly.
 * The page shows own-assigned tasks across projects, with status controls.
 *
 * Owning layer: component (RTL) — AC-W2-IXD-002.
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { tasksState } = vi.hoisted(() => ({
  tasksState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: true,
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
  tasksState.data = null;
  tasksState.isPending = true;
  tasksState.isError = false;
  tasksState.refetch.mockClear();
});

describe('MyTasks page — component states (B-1, AC-W2-IXD-002)', () => {
  it('AC-W2-IXD-002: loading state renders a skeleton', () => {
    tasksState.isPending = true;
    tasksState.data = null;
    renderMyTasks();
    // Loading state: no tasks table yet, spinner or skeleton.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('AC-W2-IXD-002: empty state renders an actionable message (no tasks assigned)', () => {
    tasksState.isPending = false;
    tasksState.data = [];
    renderMyTasks();
    expect(screen.getByText(/no tasks assigned/i)).toBeInTheDocument();
  });

  it('AC-W2-IXD-002: error state renders a retry option', () => {
    tasksState.isPending = false;
    tasksState.isError = true;
    renderMyTasks();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('AC-W2-IXD-002: populated state renders own tasks with status and project name', () => {
    tasksState.isPending = false;
    tasksState.isError = false;
    tasksState.data = [
      {
        id: 't1',
        name: 'Review design specs',
        status: 'In Progress',
        assignee_id: 'u-self',
        project_id: 'p1',
        project_name: 'Northwind ERP',
        start_date: null,
        end_date: null,
      },
    ];
    renderMyTasks();
    expect(screen.getByText('Review design specs')).toBeInTheDocument();
    expect(screen.getByText('Northwind ERP')).toBeInTheDocument();
    // The status select should have the task's current status selected.
    const statusSelect = screen.getByRole('combobox', { name: /change status of review design specs/i });
    expect(statusSelect).toHaveValue('In Progress');
  });

  it('CW-7: the project header deep-links to the project Tasks tab (role-invariant default is Overview)', () => {
    tasksState.isPending = false;
    tasksState.isError = false;
    tasksState.data = [
      {
        id: 't1', name: 'Review design specs', status: 'In Progress', assignee_id: 'u-self',
        project_id: 'p1', project_name: 'Northwind ERP', start_date: null, end_date: null,
      },
    ];
    renderMyTasks();
    // The Engineer's task entry point carries the deep-link intent, not a role-variant URL.
    expect(screen.getByRole('link', { name: 'Northwind ERP' })).toHaveAttribute(
      'href',
      '/projects/p1/tasks',
    );
  });

  it('AC-IFW-TASKS-01 defaults to active work and keeps completed tasks available', async () => {
    tasksState.isPending = false;
    tasksState.data = [
      { id: 'open', name: 'Prepare the agenda', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
      { id: 'done', name: 'Send last week notes', status: 'Done', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
    ];
    const user = userEvent.setup();
    renderMyTasks();

    expect(screen.getByRole('button', { name: 'Open tasks' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Prepare the agenda')).toBeInTheDocument();
    expect(screen.queryByText('Send last week notes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.getByText('Send last week notes')).toBeInTheDocument();
    expect(screen.queryByText('Prepare the agenda')).not.toBeInTheDocument();
  });

  it('AC-IFW-TASKS-01 searches task and project context and clearing restores the selected queue', async () => {
    tasksState.isPending = false;
    tasksState.data = [
      { id: 't1', name: 'Prepare the agenda', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
      { id: 't2', name: 'Review the estimate', status: 'To Do', assignee_id: 'u-self', project_id: 'p2', project_name: 'South project', start_date: null, end_date: null },
    ];
    const user = userEvent.setup();
    renderMyTasks();

    const search = screen.getByRole('searchbox', { name: 'Search your tasks' });
    await user.type(search, 'south');
    expect(screen.getByText('Review the estimate')).toBeInTheDocument();
    expect(screen.queryByText('Prepare the agenda')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(screen.getByText('Prepare the agenda')).toBeInTheDocument();
    expect(screen.getByText('Review the estimate')).toBeInTheDocument();
  });

  it('AC-IFW-TASKS-01 shows a useful no-results state with a clear-search remedy', async () => {
    tasksState.isPending = false;
    tasksState.data = [
      { id: 't1', name: 'Prepare the agenda', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
    ];
    const user = userEvent.setup();
    renderMyTasks();
    await user.type(screen.getByRole('searchbox', { name: 'Search your tasks' }), 'missing');
    expect(screen.getByText('No tasks match your search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('CW-7: task dates render human-formatted, never raw ISO', () => {
    tasksState.isPending = false;
    tasksState.isError = false;
    tasksState.data = [
      {
        id: 't1', name: 'Review design specs', status: 'In Progress', assignee_id: 'u-self',
        project_id: 'p1', project_name: 'Northwind ERP',
        start_date: '2026-06-14', end_date: '2026-07-01',
      },
    ];
    renderMyTasks();
    // Human-formatted (formatDate), and no raw ISO string leaks.
    expect(screen.getByText(/Start Jun 14, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Due Jul 1, 2026/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/2026-06-14|2026-07-01/);
  });
});
