/**
 * AC-DEL-010 — Tasks tab groups tasks under their milestone; ungrouped tasks appear last.
 * AC-1402 — each phase keeps its progress, dates and collapsed Done rows.
 * B7 — phases share ONE task table (one column header); each phase is a heading row inside it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-06-22', isPending: false, isError: false, retry: vi.fn() }),
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
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));

import TasksTab from '../tabs/TasksTab';
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';

/** A phase's heading row and the text of every row up to the next phase heading. */
function phase(name: RegExp) {
  const rows = within(screen.getByRole('table', { name: 'Project tasks' })).getAllByRole('row');
  const start = rows.findIndex((row) => within(row).queryByRole('rowheader', { name }));
  if (start === -1) throw new Error(`No phase heading ${name}`);
  const next = rows.findIndex((row, index) => index > start && within(row).queryByRole('rowheader'));
  const own = rows.slice(start, next === -1 ? undefined : next);
  return { heading: rows[start], text: own.map((row) => row.textContent).join(' | ') };
}

const render$ = () => {
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

describe('TasksTab grouping (AC-DEL-010)', () => {
  beforeEach(() => {
    clearOwnershipCache();
    setTaskOwnership([]);
    setProjectBindings([]);
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
    const phaseOne = phase(/Engineering design/i);
    expect(phaseOne.text).toContain('Detail drawings');
    expect(phaseOne.text).toContain('Site survey');
    expect(phaseOne.text).not.toContain('Buy steel');

    // Procurement group
    expect(phase(/Procurement/i).text).toContain('Buy steel');

    // Ungrouped group, last
    const ungrouped = phase(/ungrouped/i);
    expect(ungrouped.text).toContain('Admin task');
    const headings = within(screen.getByRole('table', { name: 'Project tasks' })).getAllByRole('rowheader');
    expect(headings[headings.length - 1]).toBe(within(ungrouped.heading).getByRole('rowheader'));
  });

  it('B7: every phase shares one task table with one column header, keeping phase meta, overdue days and Add task', () => {
    milestoneState.data = [
      { id: 'm1', project_id: 'p1', name: 'Engineering design', sort_order: 0, target_date: '2026-06-01', weight: 1, input_pct: null, task_count: 1, calculated_pct: 50, effective_pct: 50 },
      { id: 'm2', project_id: 'p1', name: 'Commissioning', sort_order: 1, target_date: null, weight: 1, input_pct: null, task_count: 0, calculated_pct: 0, effective_pct: 0 },
    ];
    tasksState.data = [
      { id: 't1', project_id: 'p1', milestone_id: 'm1', name: 'Detail drawings', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 't2', project_id: 'p1', milestone_id: null, name: 'Admin task', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
    ];
    render$();

    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getAllByRole('columnheader', { name: /^Task/ })).toHaveLength(1);
    const late = phase(/Engineering design/i);
    expect(late.text).toContain('21d late');
    expect(within(late.heading).getByText('21d late')).toHaveClass('text-destructive-text');
    // A phase with no tasks still appears in the table, with its empty note and its own Add task.
    const empty = phase(/Commissioning/i);
    expect(empty.text).toContain('No tasks in this phase yet.');
    expect(within(empty.heading).getByRole('button', { name: /Add task/ })).toBeInTheDocument();
  });

  it('AC-1402: a phase row shows its target date and server-derived progress', () => {
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

    const phaseOne = phase(/Engineering design/i);
    expect(phaseOne.text).toContain('Task A');
    expect(within(phaseOne.heading).getByText(/Target Aug 15, 2026/)).toBeInTheDocument();
    expect(within(phaseOne.heading).getByText('50%')).toBeInTheDocument();
  });

  it('sorts open phases first and folds Done tasks within each completed phase', async () => {
    const completed: MilestoneWithProgress = {
      id: 'done', project_id: 'p1', name: 'Completed phase', sort_order: 0,
      target_date: null, weight: 1, input_pct: null, task_count: 2,
      calculated_pct: 100, effective_pct: 100,
    };
    const active: MilestoneWithProgress = {
      id: 'active', project_id: 'p1', name: 'Active phase', sort_order: 1,
      target_date: null, weight: 1, input_pct: null, task_count: 3,
      calculated_pct: 50, effective_pct: 50,
    };
    milestoneState.data = [completed, active];
    tasksState.data = [
      { id: 'done-1', project_id: 'p1', milestone_id: 'done', name: 'Done task one', status: 'Done', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 'done-2', project_id: 'p1', milestone_id: 'done', name: 'Done task two', status: 'Done', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 'late', project_id: 'p1', milestone_id: 'active', name: 'Sooner due', status: 'To Do', assignee_id: null, start_date: null, end_date: '2026-06-20', created_at: '', assignee: null, dependencies: [] },
      { id: 'later', project_id: 'p1', milestone_id: 'active', name: 'Later due', status: 'In Progress', assignee_id: null, start_date: null, end_date: '2026-06-21', created_at: '', assignee: null, dependencies: [] },
    ];
    render$();

    const activeSection = phase(/Active phase/i).heading;
    const completedSection = phase(/Completed phase/i).heading;
    expect(screen.queryByText('Done task one')).not.toBeInTheDocument();
    expect(screen.queryByText('Done task two')).not.toBeInTheDocument();
    expect(screen.getByText('Sooner due').compareDocumentPosition(screen.getByText('Later due')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(activeSection.compareDocumentPosition(completedSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(within(completedSection).getByRole('button', { name: '2 done' }));
    expect(screen.getByText('Done task one')).toBeInTheDocument();
    expect(screen.getByText('Done task two')).toBeInTheDocument();
  });

  it('AC-1402: keeps Done tasks in an active phase behind a closed disclosure', async () => {
    milestoneState.data = [{
      id: 'active', project_id: 'p1', name: 'Active phase', sort_order: 0,
      target_date: null, weight: 1, input_pct: null, task_count: 2,
      calculated_pct: 50, effective_pct: 50,
    }];
    tasksState.data = [
      { id: 'open', project_id: 'p1', milestone_id: 'active', name: 'Open task', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 'done', project_id: 'p1', milestone_id: 'active', name: 'Completed task', status: 'Done', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
    ];
    render$();

    expect(screen.getByText('Open task')).toBeInTheDocument();
    expect(screen.queryByText('Completed task')).not.toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: '1 done' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Open task')).toBeInTheDocument();
    expect(screen.getByText('Completed task')).toBeInTheDocument();
  });

  it('AC-1402 shares selected task ids across phases for bulk actions', async () => {
    milestoneState.data = [
      { id: 'm1', project_id: 'p1', name: 'Phase one', sort_order: 0, target_date: null, weight: 1, input_pct: null, task_count: 1, calculated_pct: 0, effective_pct: 0 },
      { id: 'm2', project_id: 'p1', name: 'Phase two', sort_order: 1, target_date: null, weight: 1, input_pct: null, task_count: 1, calculated_pct: 0, effective_pct: 0 },
    ];
    tasksState.data = [
      { id: 'task-a', project_id: 'p1', milestone_id: 'm1', name: 'Task A', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
      { id: 'task-b', project_id: 'p1', milestone_id: 'm2', name: 'Task B', status: 'In Progress', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
    ];
    render$();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select task Task A' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select task Task B' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change status' })).toBeInTheDocument();
  });

  it('keeps task activation available from rows inside a phase', async () => {
    milestoneState.data = [{
      id: 'm1', project_id: 'p1', name: 'Engineering design', sort_order: 0,
      target_date: null, weight: 1, input_pct: null, task_count: 1,
      calculated_pct: 0, effective_pct: 0,
    }];
    tasksState.data = [
      { id: 't1', project_id: 'p1', milestone_id: 'm1', name: 'Detail drawings', status: 'To Do', assignee_id: null, start_date: null, end_date: null, created_at: '', assignee: null, dependencies: [] },
    ];
    render$();

    await userEvent.click(screen.getByRole('button', { name: 'Open task Detail drawings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Detail drawings' });
    expect(within(dialog).getByText('Details')).toBeInTheDocument();
  });
});
