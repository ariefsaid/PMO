import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

const { listState, milestoneState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[] | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  milestoneState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => listState,
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => mutations,
}));

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: realRole }),
}));

import TasksTab from '../tabs/TasksTab';

const seedMilestones: MilestoneWithProgress[] = [
  {
    id: 'ms-1',
    project_id: 'p1',
    name: 'Phase 1',
    sort_order: 0,
    target_date: '2026-06-01',
    weight: 1,
    input_pct: null,
    task_count: 1,
    calculated_pct: 0,
    effective_pct: 0,
  },
  {
    id: 'ms-2',
    project_id: 'p1',
    name: 'Phase 2',
    sort_order: 1,
    target_date: '2026-12-01',
    weight: 1,
    input_pct: null,
    task_count: 0,
    calculated_pct: 0,
    effective_pct: 0,
  },
];

const seedTasks: TaskWithRefs[] = [
  {
    id: 'task-1',
    project_id: 'p1',
    name: 'Top task 1',
    status: 'To Do',
    assignee_id: null,
    start_date: null,
    end_date: null,
    org_id: 'org-1',
    milestone_id: 'ms-1',
    parent_task_id: null,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    created_by: null,
    tombstoned_at: null,
    meeting_id: null,
    source_updated_at: null,
    description: null,
    priority: null,
    archived_at: null,
    assignee: null,
    dependencies: [],
  },
  {
    id: 'task-2',
    project_id: 'p1',
    name: 'Top task 2',
    status: 'To Do',
    assignee_id: null,
    start_date: null,
    end_date: null,
    org_id: 'org-1',
    milestone_id: 'ms-1',
    parent_task_id: null,
    created_at: '2026-01-02T00:00:00Z',
    completed_at: null,
    created_by: null,
    tombstoned_at: null,
    meeting_id: null,
    source_updated_at: null,
    description: null,
    priority: null,
    archived_at: null,
    assignee: null,
    dependencies: [],
  },
];

const renderTab = (hash = '') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/projects/p1/tasks${hash}`]}>
        <Routes>
          <Route
            path="/projects/:projectId/tasks"
            element={
              <ToastProvider>
                <TasksTab projectId="p1" />
              </ToastProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('TasksTab delayed scroll (PGB-024) and phase/parent dirty warnings (PGB-025)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listState.data = seedTasks;
    listState.isPending = false;
    listState.isError = false;
    milestoneState.data = seedMilestones;
    milestoneState.isPending = false;
    milestoneState.isError = false;
    realRole = 'Project Manager';
  });

  it('PGB-024: scrolls once when delayed task data loads, and cancels RAF/timer on unmount', async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame');

    // Initial render: tasks data is pending / empty
    listState.data = undefined;
    listState.isPending = true;

    const { unmount, rerender } = renderTab('#task-task-1');

    expect(scrollIntoView).not.toHaveBeenCalled();

    // Data resolves
    listState.data = seedTasks;
    listState.isPending = false;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/projects/p1/tasks#task-task-1']}>
          <Routes>
            <Route
              path="/projects/:projectId/tasks"
              element={
                <ToastProvider>
                  <TasksTab projectId="p1" />
                </ToastProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(cancelRafSpy).toHaveBeenCalled();
  });

  it('PGB-025: warns of unsaved changes when closing task dialog after only phase is changed', async () => {
    renderTab();
    const user = userEvent.setup();

    // Open task row drawer
    await user.click(screen.getByText('Top task 1'));
    const drawer = await screen.findByRole('dialog', { name: 'Top task 1' });
    await user.click(within(drawer).getByRole('button', { name: 'Edit' }));

    const editDialog = await screen.findByRole('dialog', { name: /Edit task/i });

    // Open Phase combobox and select Phase 2
    const phaseCombobox = within(editDialog).getByRole('combobox', { name: /Phase/i });
    await user.click(phaseCombobox);
    const option = await screen.findByRole('option', { name: /Phase 2/i });
    await user.click(option);

    // Close the dialog by clicking Cancel
    const cancelBtn = within(editDialog).getByRole('button', { name: /cancel/i });
    await user.click(cancelBtn);

    // Confirmation dialog for unsaved changes must appear
    expect(await screen.findByText(/Discard your changes/i)).toBeInTheDocument();
  });

  it('PGB-025: warns of unsaved changes when closing task dialog after only parent task is changed', async () => {
    renderTab();
    const user = userEvent.setup();

    // Open task row drawer
    await user.click(screen.getByText('Top task 1'));
    const drawer = await screen.findByRole('dialog', { name: 'Top task 1' });
    await user.click(within(drawer).getByRole('button', { name: 'Edit' }));

    const editDialog = await screen.findByRole('dialog', { name: /Edit task/i });

    // Open Parent task combobox and select Top task 2
    const parentCombobox = within(editDialog).getByRole('combobox', { name: /Parent task/i });
    await user.click(parentCombobox);
    const option = await screen.findByRole('option', { name: /Top task 2/i });
    await user.click(option);

    // Close the dialog by clicking Cancel
    const cancelBtn = within(editDialog).getByRole('button', { name: /cancel/i });
    await user.click(cancelBtn);

    // Confirmation dialog for unsaved changes must appear
    expect(await screen.findByText(/Discard your changes/i)).toBeInTheDocument();
  });
});
