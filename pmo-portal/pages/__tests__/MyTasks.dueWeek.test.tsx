import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * #1461 — the dashboard "Tasks due" figure counts open tasks due by the end of the current
 * week; its drill carries `?due=week`, and the list must then show exactly that set.
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

// The page reads today in the viewer timezone; pin it mid-week (Wednesday) so the
// due-by-Sunday bound is distinct from "today" and from "next week".
vi.mock('@/src/hooks/useOrgToday', () => ({
  useOrgToday: () => '2026-06-10',
}));

const { tasksState, mutationsState } = vi.hoisted(() => ({
  tasksState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutationsState: {
    updateStatus: { mutate: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => tasksState,
  useMyTaskMutations: () => mutationsState,
}));

import MyTasks from '../MyTasks';

const makeTask = (id: string, endDate: string | null, status = 'To Do') => ({
  id,
  name: `Task ${id}`,
  status,
  assignee_id: 'u-self',
  project_id: 'proj-alpha',
  project_name: 'Alpha',
  project_contractual_name: null,
  end_date: endDate,
  description: null,
});

const renderMyTasks = (initialEntry = '/my-tasks') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <MyTasks />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  tasksState.data = [
    makeTask('overdue', '2026-06-01'),
    makeTask('due-friday', '2026-06-12'),
    // Sunday of the w/c 2026-06-08 week is 2026-06-14: still inside the figure's set.
    makeTask('due-sunday', '2026-06-14'),
    makeTask('due-next-week', '2026-06-20'),
    makeTask('undated', null),
    makeTask('done-due-soon', '2026-06-12', 'Done'),
  ];
  tasksState.isPending = false;
  tasksState.isError = false;
});

describe('#1461 — My Tasks ?due=week drill filter', () => {
  it('without due=week the open queue shows every open task', () => {
    renderMyTasks('/my-tasks');
    for (const id of ['overdue', 'due-friday', 'due-sunday', 'due-next-week', 'undated']) {
      expect(screen.getByRole('link', { name: new RegExp(`Task ${id}`) })).toBeInTheDocument();
    }
  });

  it('with due=week only open tasks due by the end of this week remain (the figure set)', () => {
    renderMyTasks('/my-tasks?due=week');
    expect(screen.getByRole('link', { name: /Task overdue/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Task due-friday/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Task due-sunday/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task due-next-week/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task undated/ })).not.toBeInTheDocument();
    // Completed tasks stay governed by the queue toggle, not the due window.
    expect(screen.queryByRole('link', { name: /Task done-due-soon/ })).not.toBeInTheDocument();
  });

  it('names the active window and clears it back to the full list', async () => {
    const user = userEvent.setup();
    renderMyTasks('/my-tasks?due=week');
    expect(screen.getByText('Due this week')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Clear the due-this-week filter/i }));
    expect(screen.queryByText('Due this week')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task due-next-week/ })).toBeInTheDocument();
  });
});
