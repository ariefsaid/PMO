import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-IFW-TASKS-02 — Each task row in My Tasks exposes a "Log time" link
 * navigating to /timesheets?project=<task.project_id>.
 *
 * Lens-D regression invariant: a My-Tasks row exposes a Log-time link
 * carrying `?project=<id>`.
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

import MyTasksComponent from '../MyTasks';

const task = {
  id: 't-1',
  project_id: 'p-abc',
  project_name: 'Solar Phase 1',
  name: 'Wire the inverters',
  status: 'In Progress',
  start_date: null,
  end_date: '2099-12-31',
};

const renderMyTasks = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
        <ToastProvider>
          <MyTasksComponent />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  tasksState.data = [task];
  tasksState.isPending = false;
  tasksState.isError = false;
  tasksState.refetch.mockClear();
});

describe('MyTasks — Log time action (AC-IFW-TASKS-02)', () => {
  it('AC-IFW-TASKS-02: each task row has a neutral "Log time" link', () => {
    renderMyTasks();
    const logTimeLink = screen.getByRole('link', { name: /log time/i });
    expect(logTimeLink).toBeInTheDocument();
    expect(logTimeLink.className).toContain('border-input');
    expect(logTimeLink.className).not.toContain('text-primary-text');
  });

  it('AC-IFW-TASKS-02: Log time link carries ?project=<task.project_id>', () => {
    renderMyTasks();
    const logTimeLink = screen.getByRole('link', { name: /log time/i });
    expect(logTimeLink).toHaveAttribute('href', '/timesheets?project=p-abc');
  });

  it('AC-IFW-TASKS-02: each task gets its own project-specific log time link', () => {
    tasksState.data = [
      { ...task, id: 't-1', project_id: 'p-111', project_name: 'Project Alpha', name: 'Task A' },
      { ...task, id: 't-2', project_id: 'p-222', project_name: 'Project Beta', name: 'Task B' },
    ];
    renderMyTasks();
    const links = screen.getAllByRole('link', { name: /log time/i });
    expect(links).toHaveLength(2);
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/timesheets?project=p-111');
    expect(hrefs).toContain('/timesheets?project=p-222');
  });
});
