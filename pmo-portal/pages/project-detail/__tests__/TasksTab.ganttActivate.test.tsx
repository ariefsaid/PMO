/**
 * AC-JR-T23: TasksTab wires ProjectGantt.onActivateTask so clicking a Gantt bar
 * opens the task edit modal (the same setFormTarget the List view uses).
 *
 * This is the consumer test for the T22 seam (ProjectGantt.onActivateTask added
 * in jtbd-p0-shared). Bars in the Timeline view must open the TaskFormModal when
 * clicked by a user who can edit tasks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks (mirror TasksTab.timeline.test.tsx) ─────────────────────────────────

const { listState, milestoneState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
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

let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));

import TasksTab from '../tabs/TasksTab';

// Tasks with dates so the Gantt has bars to click
const seed = [
  {
    id: 't1',
    project_id: 'p1',
    name: 'Survey the site',
    status: 'To Do' as const,
    assignee_id: null,
    start_date: '2026-01-01',
    end_date: '2026-01-15',
    org_id: 'org-1',
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    assignee: null,
    dependencies: [],
  },
  {
    id: 't2',
    project_id: 'p1',
    name: 'Mobilise crew',
    status: 'In Progress' as const,
    assignee_id: null,
    start_date: '2026-01-10',
    end_date: '2026-01-20',
    org_id: 'org-1',
    milestone_id: null,
    created_at: '2026-02-01T00:00:00Z',
    assignee: null,
    dependencies: [],
  },
];

const renderTab = (role: Role = 'Project Manager', userId = 'pm-1') => {
  realRole = role;
  currentUserId = userId;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/tasks']}>
        <ToastProvider>
          <TasksTab projectId="p1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  milestoneState.data = [];
  milestoneState.isPending = false;
  milestoneState.isError = false;
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
});

// ── AC-JR-T23: Gantt bars are activatable ─────────────────────────────────────

describe('AC-JR-T23: TasksTab Gantt bars open the task edit modal when clicked', () => {
  it('AC-JR-T23: switching to Timeline view shows the Gantt figure', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
  });

  it('AC-JR-T23: clicking a Gantt bar (role=button) opens the task edit modal', async () => {
    renderTab('Project Manager');
    // Switch to timeline view
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    // Bar has role=button (added by T22 seam when onActivateTask is provided)
    const bar = screen.getByRole('button', { name: /Survey the site/i });
    expect(bar).toBeInTheDocument();

    // Click the bar — should open the task edit modal
    fireEvent.click(bar);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // The modal should show the task name pre-filled
    expect(screen.getByDisplayValue('Survey the site')).toBeInTheDocument();
  });

  it('AC-JR-T23: modal opened from Gantt bar shows Edit task title', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Survey the site/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // Edit modal should have "Edit task" or "Save task" button
    expect(screen.getByRole('button', { name: /save task/i })).toBeInTheDocument();
  });

  it('AC-JR-T23: Gantt bars are inert (no button role) when user cannot edit tasks', async () => {
    // Finance role cannot edit tasks
    renderTab('Finance');
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    // Bars should NOT have role=button for read-only users
    expect(screen.queryByRole('button', { name: /Survey the site/i })).toBeNull();
    // Task name text is still visible (Gantt v2 shows it in both table + bar).
    expect(screen.getAllByText('Survey the site').length).toBeGreaterThan(0);
  });
});
