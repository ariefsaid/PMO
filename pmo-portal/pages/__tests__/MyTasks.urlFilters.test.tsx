import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * R2 (ux/1110): the My Tasks queue (open/completed) and search box are URL-owned like the
 * `due=week` drill, so a filtered view survives drilling into a task and pressing Back,
 * or a refresh.
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
  { id: 'open', name: 'Prepare the agenda', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
  { id: 'done', name: 'Send last week notes', status: 'Done', assignee_id: 'u-self', project_id: 'p1', project_name: 'North project', start_date: null, end_date: null },
  { id: 'specs', name: 'Review design specs', status: 'In Progress', assignee_id: 'u-self', project_id: 'p1', project_name: 'Northwind ERP', start_date: null, end_date: null },
];

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderMyTasks = (initialEntry = '/my-tasks') =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <LocationProbe />
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

describe('R2 — the My Tasks queue and search live in the URL', () => {
  it('a refresh of ?queue=completed reopens the completed queue', () => {
    renderMyTasks('/my-tasks?queue=completed');
    expect(screen.getByRole('button', { name: 'Completed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Send last week notes')).toBeInTheDocument();
    expect(screen.queryByText('Prepare the agenda')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?queue=completed');
  });

  it('switching back to the open queue clears queue from the URL (default stays out)', async () => {
    const user = userEvent.setup();
    renderMyTasks('/my-tasks?queue=completed');
    await user.click(screen.getByRole('button', { name: 'Open tasks' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '');
    expect(screen.getByText('Prepare the agenda')).toBeInTheDocument();
  });

  it('a refresh of ?q=specs reopens with the search box filled and the list narrowed', () => {
    renderMyTasks('/my-tasks?q=specs');
    const search = screen.getByRole('searchbox', { name: 'Search your tasks' }) as HTMLInputElement;
    expect(search).toHaveValue('specs');
    expect(screen.getByText('Review design specs')).toBeInTheDocument();
    expect(screen.queryByText('Prepare the agenda')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=specs');
  });

  it('typing in the search box writes the query into the URL', async () => {
    const user = userEvent.setup();
    renderMyTasks('/my-tasks');
    const search = screen.getByRole('searchbox', { name: 'Search your tasks' });
    await user.type(search, 'agenda');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?q=agenda');
  });
});
