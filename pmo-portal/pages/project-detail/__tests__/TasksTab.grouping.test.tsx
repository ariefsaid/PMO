/**
 * AC-DEL-010 — Tasks tab groups tasks under their milestone; ungrouped tasks appear last.
 * FR-DEL-015 — Each milestone heading shows name + target date only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Stubs ────────────────────────────────────────────────────────────────────

const milestoneState = {
  data: [] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

const tasksState = {
  data: [] as unknown[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => tasksState,
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import TasksTab from '../tabs/TasksTab';

const render$ = () =>
  render(
    <ToastProvider>
      <TasksTab projectId="p1" />
    </ToastProvider>,
  );

describe('TasksTab grouping (AC-DEL-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksState.isPending = false;
    tasksState.isError = false;
  });

  it('AC-DEL-010: T1,T2 render under an M1 heading; T3 under M2; T4 under a trailing "Ungrouped" section', () => {
    const m1: MilestoneWithProgress = {
      id: 'm1', project_id: 'p1', name: 'Engineering design', sort_order: 0,
      target_date: null, weight: 1, input_pct: null, task_count: 2,
      calculated_pct: 50, effective_pct: 50,
    };
    const m2: MilestoneWithProgress = {
      id: 'm2', project_id: 'p1', name: 'Procurement', sort_order: 1,
      target_date: '2026-09-01', weight: 1, input_pct: null, task_count: 1,
      calculated_pct: 0, effective_pct: 0,
    };
    milestoneState.data = [m1, m2];
    tasksState.data = [
      { id: 't1', project_id: 'p1', milestone_id: 'm1', name: 'Detail drawings', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 't2', project_id: 'p1', milestone_id: 'm1', name: 'Site survey', status: 'In Progress', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 't3', project_id: 'p1', milestone_id: 'm2', name: 'Buy steel', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 't4', project_id: 'p1', milestone_id: null, name: 'Admin task', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
    ];
    render$();

    // Engineering design group
    const m1Section = screen.getByRole('region', { name: /Engineering design/i });
    expect(within(m1Section).getByText('Detail drawings')).toBeInTheDocument();
    expect(within(m1Section).getByText('Site survey')).toBeInTheDocument();
    expect(within(m1Section).queryByText('Buy steel')).toBeNull();

    // Procurement group
    const m2Section = screen.getByRole('region', { name: /Procurement/i });
    expect(within(m2Section).getByText('Buy steel')).toBeInTheDocument();

    // Ungrouped section
    const ungroupedSection = screen.getByRole('region', { name: /ungrouped/i });
    expect(within(ungroupedSection).getByText('Admin task')).toBeInTheDocument();
  });

  it('FR-DEL-015: each milestone heading shows its name + target date only', () => {
    const m1: MilestoneWithProgress = {
      id: 'm1', project_id: 'p1', name: 'Engineering design', sort_order: 0,
      target_date: '2026-08-15', weight: 1, input_pct: null, task_count: 2,
      calculated_pct: 50, effective_pct: 50,
    };
    milestoneState.data = [m1];
    tasksState.data = [
      { id: 't1', project_id: 'p1', milestone_id: 'm1', name: 'Task A', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
    ];
    render$();

    const m1Section = screen.getByRole('region', { name: /Engineering design/i });
    expect(within(m1Section).getByText(/Engineering design/i)).toBeInTheDocument();
    expect(within(m1Section).getByText('Target 15 Aug')).toBeInTheDocument();
    expect(within(m1Section).queryByText(/50%/i)).toBeNull();
  });
});
