import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-IFW-TASKS-01 — My Tasks renders tasks ordered by urgency within a project group:
 *   - Overdue tasks (end_date in past + status != Done) sort FIRST and carry an "Overdue" flag.
 *   - Done tasks sink BELOW open ones regardless of created_at order.
 *
 * Lens-D regression invariant: overdue ordering and badge are stable.
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

const PAST_DATE = '2024-01-01'; // safely in the past
const FUTURE_DATE = '2099-12-31'; // safely in the future

/** Server order intentionally puts Done/future work before an overdue item. */
const tasksForProject = [
  {
    id: 't-done',
    project_id: 'p-1',
    project_name: 'Solar Phase 1',
    name: 'Done Task',
    status: 'Done',
    start_date: null,
    end_date: PAST_DATE,
  },
  {
    id: 't-future',
    project_id: 'p-1',
    project_name: 'Solar Phase 1',
    name: 'Future Task',
    status: 'To Do',
    start_date: null,
    end_date: FUTURE_DATE,
  },
  {
    id: 't-overdue',
    project_id: 'p-1',
    project_name: 'Solar Phase 1',
    name: 'Overdue Task',
    status: 'To Do',
    start_date: null,
    end_date: PAST_DATE,
  },
];

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location-probe" data-search={location.search} />;
};

const renderMyTasks = (initialPath = '/my-tasks') =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <ToastProvider>
          {/* Import lazily after mock is set */}
          <MyTasksComponent />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

// Import after mock declaration
import MyTasksComponent from '../MyTasks';

beforeEach(() => {
  tasksState.data = [...tasksForProject];
  tasksState.isPending = false;
  tasksState.isError = false;
  tasksState.refetch.mockClear();
});

describe('MyTasks — urgency ordering + overdue flag (AC-IFW-TASKS-01)', () => {
  it('AC-IFW-TASKS-01: overdue work sorts ahead of future work across projects', () => {
    tasksState.data = [
      { ...tasksForProject[1], id: 't-future-p1' },
      { ...tasksForProject[2], id: 't-overdue-p2', project_id: 'p-2', project_name: 'Harbour Upgrade' },
    ];
    renderMyTasks();
    const overdueEl = screen.getByText('Overdue Task');
    const futureEl = screen.getByText('Future Task');
    const order = overdueEl.compareDocumentPosition(futureEl);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Solar Phase 1' })).not.toBeInTheDocument();
  });

  it('C-03: equal urgency and due dates use task name before project name', () => {
    tasksState.data = [
      { ...tasksForProject[1], id: 't-zulu', name: 'Zulu task', project_name: 'Alpha project' },
      { ...tasksForProject[1], id: 't-alpha', name: 'Alpha task', project_name: 'Zulu project' },
    ];
    renderMyTasks();

    const alpha = screen.getByText('Alpha task');
    const zulu = screen.getByText('Zulu task');
    expect(alpha.compareDocumentPosition(zulu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('C-06: no-match recovery clears search, status and project while keeping sort', async () => {
    const user = userEvent.setup();
    renderMyTasks('/my-tasks?status=completed&project=p-2&q=missing&sort=due');
    expect(screen.getByText('No tasks match your search')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));

    const params = new URLSearchParams(screen.getByTestId('location-probe').getAttribute('data-search'));
    expect(params.get('status')).toBeNull();
    expect(params.get('project')).toBeNull();
    expect(params.get('q')).toBeNull();
    expect(params.get('sort')).toBe('due');
    expect(screen.getByText('Future Task')).toBeInTheDocument();
  });

  it('AC-IFW-TASKS-01: completed tasks stay out of the default open queue and remain reachable', async () => {
    const user = userEvent.setup();
    renderMyTasks();
    expect(screen.queryByText('Done Task')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.getByText('Done Task')).toBeInTheDocument();
    expect(screen.queryByText('Overdue Task')).not.toBeInTheDocument();
  });

  it('AC-IFW-TASKS-01: overdue task carries an "Overdue" status flag/badge', () => {
    renderMyTasks();
    // The pill renders the exact text "Overdue" (StatusPill variant="warn")
    // Use exact match to avoid matching the task name "Overdue Task"
    const badges = screen.getAllByText(/^overdue$/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  it('AC-WORK-TASKS-01: search, status, project and urgency controls persist their scope in the URL', async () => {
    tasksState.data = [
      { ...tasksForProject[1], id: 't-north', project_id: 'p-1' },
      { ...tasksForProject[1], id: 't-south', name: 'South task', project_id: 'p-2', project_name: 'South project' },
    ];
    const user = userEvent.setup();
    renderMyTasks();
    const toolbar = screen.getByTestId('my-tasks-toolbar');
    const controls = [
      screen.getByRole('searchbox', { name: /Search your tasks/i }),
      screen.getByRole('button', { name: /Open tasks/i }),
      screen.getByLabelText(/Filter by project/i),
      screen.getByLabelText(/Sort tasks/i),
    ];
    expect(controls.every((control) => toolbar.contains(control))).toBe(true);
    await user.selectOptions(controls[2], 'p-1');
    expect(new URLSearchParams(screen.getByTestId('location-probe').getAttribute('data-search')).get('project')).toBe('p-1');
    expect(screen.getByText('Future Task')).toBeInTheDocument();
    expect(screen.queryByText('South task')).not.toBeInTheDocument();
    await user.selectOptions(controls[3], 'due');
    expect(new URLSearchParams(screen.getByTestId('location-probe').getAttribute('data-search')).get('sort')).toBe('due');
  });

  it('AC-IFW-TASKS-01: Done task does NOT carry an "Overdue" flag even with past end_date', () => {
    renderMyTasks();
    // Only one "Overdue" badge should appear, not two
    const overdueBadges = screen.getAllByText(/^overdue$/i);
    expect(overdueBadges).toHaveLength(1);
  });

  it('AC-IFW-TASKS-01: Future task does NOT carry an "Overdue" flag', () => {
    // Render only the future (non-overdue) task
    tasksState.data = [
      {
        id: 't-future',
        project_id: 'p-1',
        project_name: 'Solar Phase 1',
        name: 'Future Task',
        status: 'To Do',
        start_date: null,
        end_date: FUTURE_DATE,
      },
    ];
    renderMyTasks();
    expect(screen.queryByText(/^overdue$/i)).not.toBeInTheDocument();
  });
});
