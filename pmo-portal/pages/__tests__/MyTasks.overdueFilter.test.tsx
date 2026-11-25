import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * M6 (acceptance 01-management, TC-M-06 "Overdue follow-ups"): the company-wide task list must be
 * filterable to what is late, in one action, so a manager chases what is overdue. The queue is
 * URL-owned like the `queue` and `due=week` filters, so Back and a refresh keep the filtered view.
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-06-10' }));

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
  useMyTaskMutations: () => ({ updateStatus: { mutate: vi.fn(), isPending: false } }),
}));

vi.mock('@/src/hooks/useTaskLinkedRecords', () => ({ useTaskLinkedRecords: () => ({ data: undefined }) }));

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

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderMyTasks = (initialEntry = '/my-tasks') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <LocationProbe />
          <MyTasks />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  tasksState.data = [
    makeTask('late-one', '2026-06-01'),
    makeTask('late-two', '2026-06-09'),
    makeTask('due-friday', '2026-06-12'),
    makeTask('undated', null),
    makeTask('done-late', '2026-06-01', 'Done'),
  ];
  tasksState.isPending = false;
  tasksState.isError = false;
});

describe('M6 — My Tasks filtered to Overdue', () => {
  it('picking Overdue shows only open tasks past their deadline, and names the filter in the URL', async () => {
    renderMyTasks();
    for (const id of ['late-one', 'late-two', 'due-friday', 'undated']) {
      expect(screen.getByRole('link', { name: new RegExp(`Task ${id}`) })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole('button', { name: /^overdue$/i }));

    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?queue=overdue');
    expect(screen.getByRole('link', { name: /Task late-one/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Task late-two/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task due-friday/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task undated/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task done-late/ })).not.toBeInTheDocument();
  });

  it('a refresh of ?queue=overdue reopens the overdue view', () => {
    renderMyTasks('/my-tasks?queue=overdue');
    expect(screen.getByRole('link', { name: /Task late-one/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task due-friday/ })).not.toBeInTheDocument();
  });

  it('an overdue view with nothing late says so, in the operator\'s words', () => {
    tasksState.data = [makeTask('due-friday', '2026-06-12')];
    renderMyTasks('/my-tasks?queue=overdue');
    expect(screen.getByText(/nothing is overdue/i)).toBeInTheDocument();
  });
});
