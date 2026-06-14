import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * Fix #6 — My Tasks: task name must navigate (not be an inert span),
 * and status must use the app's shared control (SelectField) not a raw OS <select>.
 *
 * AC-FIX6-NAV-01: the task name is a link to /projects/:id/tasks (the project's tasks tab).
 * AC-FIX6-NAV-02: the status control uses SelectField (has an accessible label via hideLabel).
 * AC-FIX6-NAV-03: status control is NOT a raw unstyled <select> (raw selects lack FieldShell wrapping).
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
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

const TASK = {
  id: 't-1',
  name: 'Wire up the API endpoint',
  status: 'In Progress',
  assignee_id: 'u-self',
  project_id: 'proj-alpha',
  project_name: 'Alpha Launch',
  start_date: null,
  end_date: null,
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
  tasksState.data = [TASK];
  tasksState.isPending = false;
  tasksState.isError = false;
  mutationsState.updateStatus.mutate.mockClear();
});

describe('MyTasks — open-task navigation + shared status control (fix #6)', () => {
  it('AC-FIX6-NAV-01: task name is a link to the project Tasks tab with task anchor (T25)', () => {
    // T25 (AC-JR-T25) upgrade: the task name now deep-links to the specific task row via
    // a #task-<id> anchor so TasksTab can scroll-into-view and highlight that task.
    // The GOAL (navigates to this task) is unchanged; the step (href) reflects T25.
    renderMyTasks();
    const link = screen.getByRole('link', { name: /Wire up the API endpoint/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/projects/proj-alpha/tasks#task-t-1');
  });

  it('AC-FIX6-NAV-02: status control has an accessible label (SelectField with hideLabel)', () => {
    renderMyTasks();
    // SelectField with hideLabel still provides a visually-hidden accessible label
    // so the control is findable by ARIA role + label text.
    const statusControl = screen.getByRole('combobox', {
      name: /change status of wire up the api endpoint/i,
    });
    expect(statusControl).toBeInTheDocument();
  });

  it('AC-FIX6-NAV-03: the status control is wrapped in a FieldShell (has a label element)', () => {
    renderMyTasks();
    // SelectField renders a <label> (via FieldShell), unlike a raw <select>.
    // Find the label associated with the combobox.
    const statusControl = screen.getByRole('combobox', {
      name: /change status of wire up the api endpoint/i,
    });
    // The FieldShell label element should exist in the DOM
    const labelEl = document.querySelector(`label[for="${statusControl.id}"]`);
    expect(labelEl).toBeTruthy();
  });
});
