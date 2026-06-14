import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

/** Three tasks for one project — server order: Done first (top), then future, then overdue. */
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

const renderMyTasks = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
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
  it('AC-IFW-TASKS-01: overdue task sorts before future task within a project group', () => {
    renderMyTasks();
    // Both tasks are within the "Solar Phase 1" group
    const overdueEl = screen.getByText('Overdue Task');
    const futureEl = screen.getByText('Future Task');
    // compareDocumentPosition: 4 = FOLLOWING, 2 = PRECEDING
    // Overdue Task should appear BEFORE Future Task in DOM
    const order = overdueEl.compareDocumentPosition(futureEl);
    // 4 (DOCUMENT_POSITION_FOLLOWING) means futureEl is after overdueEl
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-IFW-TASKS-01: Done task sinks below all open tasks', () => {
    renderMyTasks();
    const overdueEl = screen.getByText('Overdue Task');
    const doneEl = screen.getByText('Done Task');
    // Done task should appear AFTER overdue task
    const order = overdueEl.compareDocumentPosition(doneEl);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-IFW-TASKS-01: overdue task carries an "Overdue" status flag/badge', () => {
    renderMyTasks();
    // The pill renders the exact text "Overdue" (StatusPill variant="warn")
    // Use exact match to avoid matching the task name "Overdue Task"
    const badges = screen.getAllByText(/^overdue$/i);
    expect(badges.length).toBeGreaterThan(0);
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
