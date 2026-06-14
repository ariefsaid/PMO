/**
 * AC-GANTT-009: selecting Timeline renders the Gantt and unmounts the list.
 * Mirrors the setup in TasksTab.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Mocks (must mirror TasksTab.test.tsx to avoid double-registration) ────────
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

// Two tasks with dates so the timeline has something to plot
const seed = [
  {
    id: 't1',
    project_id: 'p1',
    name: 'Survey the site',
    status: 'To Do',
    assignee_id: null,
    start_date: '2026-01-01',
    end_date: '2026-01-11',
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
    status: 'In Progress',
    assignee_id: null,
    start_date: '2026-01-06',
    end_date: '2026-01-11',
    org_id: 'org-1',
    milestone_id: null,
    created_at: '2026-02-01T00:00:00Z',
    assignee: null,
    dependencies: [],
  },
];

const renderTab = () =>
  render(
    <MemoryRouter initialEntries={['/projects/p1/tasks']}>
      <ToastProvider>
        <TasksTab projectId="p1" />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  milestoneState.data = [];
  milestoneState.isPending = false;
  milestoneState.isError = false;
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
});

// ── AC-GANTT-009 ──────────────────────────────────────────────────────────────

describe('AC-GANTT-009: selecting Timeline renders the Gantt and unmounts the list', () => {
  it('Timeline toggle is visible when tasks exist', () => {
    renderTab();
    expect(screen.getByRole('tab', { name: /timeline/i })).toBeInTheDocument();
  });

  it('clicking Timeline renders the Gantt figure (role="img") and removes the DataTable', async () => {
    renderTab();

    // Initially on List view — DataTable rows are present
    expect(screen.getByText('Survey the site')).toBeInTheDocument();

    // Click the Timeline toggle
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));

    await waitFor(() => {
      // Gantt is now rendered
      expect(screen.getByRole('img')).toBeInTheDocument();
    });

    // The list table row for task names should no longer be present (DataTable unmounted)
    // Note: task names still appear inside the Gantt bars — but there's no DataTable row
    // We check the table is gone by verifying no <table> element is present
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switching back to List view from Timeline restores the DataTable', async () => {
    renderTab();

    // Go to Timeline
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    // Go back to List
    await userEvent.click(screen.getByRole('tab', { name: /list/i }));
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());

    // DataTable is back
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
