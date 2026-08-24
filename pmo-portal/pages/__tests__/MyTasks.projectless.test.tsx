import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * #525 FR-FCT-040/041/042 — My Tasks renders a task that has NO project.
 *
 * ⚑ Every assertion here is a NEGATIVE about a URL, and that is deliberate. The defect is not that
 * the page crashes — it does not. It is that `t.project_id` was interpolated straight into a route,
 * so a NULL produced a live link to `/projects/null/tasks` and a "Log time" control pointing at a
 * destination that cannot accept the task (`timesheet_entries.project_id` stays NOT NULL,
 * FR-FCT-005). Both render fine and both are wrong, which is why the typechecker never found them:
 * a template literal accepts null happily.
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
  useMyTaskMutations: () => ({ updateStatus: { mutate: vi.fn(), isPending: false } }),
}));

import MyTasksComponent from '../MyTasks';

const projectTask = {
  id: 't-with',
  project_id: 'p-abc',
  project_name: 'Solar Phase 1',
  name: 'Wire the inverters',
  status: 'In Progress',
  start_date: null,
  end_date: '2099-12-31',
  assignee_id: 'u-self',
};

const looseTask = {
  ...projectTask,
  id: 't-without',
  project_id: null,
  project_name: null,
  name: 'Chase the permit office',
};

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <ImpersonationProvider realRole="Engineer">
          <MyTasksComponent />
        </ImpersonationProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('My Tasks — a task with no project (#525)', () => {
  beforeEach(() => {
    tasksState.data = [projectTask, looseTask];
  });

  it('AC-FCT-040: renders the project-less task alongside the project-carrying one', () => {
    renderPage();
    expect(screen.getByText('Chase the permit office')).toBeInTheDocument();
    expect(screen.getByText('Wire the inverters')).toBeInTheDocument();
  });

  it('AC-FCT-041: groups it under a plain heading, and NEVER links to /projects/null', () => {
    renderPage();
    const heading = screen.getByTestId('my-tasks-no-project-heading');
    expect(heading).toBeInTheDocument();
    expect(heading.tagName).not.toBe('A');
    // The whole point: no anchor anywhere on the page points into a null project.
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('/projects/null'))).toBe(false);
    // …and the project-carrying group still links, so the fix did not flatten both cases.
    expect(hrefs.some((h) => h === '/projects/p-abc/tasks')).toBe(true);
  });

  it('AC-FCT-042: offers no Log time on it — the destination cannot accept it', () => {
    renderPage();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    // exactly one Log-time link: the project-carrying task's
    expect(hrefs.filter((h) => h.startsWith('/timesheets?project='))).toEqual([
      '/timesheets?project=p-abc',
    ]);
    expect(hrefs.some((h) => h.includes('project=null'))).toBe(false);
  });

  it('AC-FCT-041: the task NAME is plain text when there is no project to deep-link into', () => {
    renderPage();
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links).not.toContain('Chase the permit office');
    expect(links).toContain('Wire the inverters');
  });
});
