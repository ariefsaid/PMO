/**
 * Floor tests for My tasks (floor-wave2).
 *
 * Four controls a person presses on this queue that nothing drove end-to-end: the project group
 * heading, the task name (both the project and the meeting-linked variant), Log time, and the
 * error-state Retry. Each asserts the OUTCOME — the route that opens, the read that is re-issued.
 * The harness mirrors `pages/__tests__/MyTasks.test.tsx` (same hook mocks, same impersonation
 * provider); the router is real so a click's destination is observable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const h = vi.hoisted(() => ({
  tasks: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => h.tasks,
  useMyTaskMutations: () => ({
    updateStatus: { mutate: vi.fn(), isPending: false },
  }),
}));

import MyTasks from '../MyTasks';

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
      data-hash={location.hash}
    />
  );
};

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter initialEntries={['/my-tasks']}>
        <ToastProvider>
          <LocationProbe />
          <MyTasks />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const probe = () => screen.getByTestId('location-probe');

const projectTask = {
  id: 't1',
  name: 'Review design specs',
  status: 'In Progress',
  assignee_id: 'u-self',
  project_id: 'p1',
  project_name: 'Northwind ERP',
  start_date: null,
  end_date: null,
  priority: null,
  archived_at: null,
};

beforeEach(() => {
  h.tasks.data = [projectTask];
  h.tasks.isPending = false;
  h.tasks.isError = false;
  h.tasks.refetch.mockClear();
});

describe('My tasks floor — doors out of the queue', () => {
  it('floor: the project group heading opens that project’s Tasks tab', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Northwind ERP' }));
    expect(probe().dataset.pathname).toBe('/projects/p1/tasks');
  });

  it('floor: a task name opens the Tasks tab at that task’s row', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Review design specs' }));
    expect(probe().dataset.pathname).toBe('/projects/p1/tasks');
    expect(probe().dataset.hash).toBe('#task-t1');
  });

  it('floor: a meeting-born task opens the meeting at that task’s row', async () => {
    h.tasks.data = [
      { ...projectTask, id: 't2', name: 'Send the minutes', project_id: null, project_name: null, meeting_id: 'mtg-9' },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Send the minutes' }));
    expect(probe().dataset.pathname).toBe('/meetings/mtg-9');
    expect(probe().dataset.hash).toBe('#task-t2');
  });

  it('floor: Log time opens Timesheets pre-filled with the task’s project', async () => {
    renderPage();
    const group = screen.getByRole('region', { name: 'Northwind ERP' });
    await userEvent.click(within(group).getByRole('link', { name: /Log time/i }));
    expect(probe().dataset.pathname).toBe('/timesheets');
    expect(probe().dataset.search).toBe('?project=p1');
  });
});

describe('My tasks floor — recoveries', () => {
  it('floor: the error-state Retry re-reads the queue', async () => {
    h.tasks.data = [];
    h.tasks.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(h.tasks.refetch).toHaveBeenCalled();
  });
});
