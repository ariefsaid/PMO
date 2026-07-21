/**
 * OD-INT-9 — subtasks nest under their parent in the Tasks List view (flat + milestone-grouped),
 * the parent picker excludes self/descendants (cycle guard), and a subtask whose parent falls
 * outside the current milestone group still renders (never silently vanishes).
 *
 * AC-SUB-UI-001  flat list: a 3-level chain renders parent-then-children in order, indented by depth.
 * AC-SUB-UI-002  a top-level task with no subtasks renders alone, unindented.
 * AC-SUB-UI-003  the parent-task Combobox excludes the task itself AND all of its descendants.
 * AC-SUB-UI-004  a subtask whose parent sits in a DIFFERENT milestone group still renders in its
 *                own group (not vanished), at depth 0 (no indentation — its parent isn't in this slice).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const { listState, profilesState, mutations, milestoneState } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  profilesState: { data: [] as unknown[], isPending: false, isError: false },
  milestoneState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
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
  useAssignableProfiles: () => profilesState,
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

const profiles = [{ id: 'pm-1', full_name: 'Pat Manager', role: 'Project Manager' }];

/** Minimal TaskWithRefs-shaped seed row. */
const t = (id: string, name: string, parent_task_id: string | null = null, milestone_id: string | null = null) => ({
  id,
  project_id: 'p1',
  milestone_id,
  name,
  status: 'To Do',
  assignee_id: null,
  start_date: null,
  end_date: null,
  org_id: 'org-1',
  created_at: `2026-01-0${id.length}T00:00:00Z`,
  assignee: null,
  dependencies: [],
  parent_task_id,
});

const renderTab = () => {
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
  listState.data = [];
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  milestoneState.data = [];
  milestoneState.isPending = false;
  milestoneState.isError = false;
  profilesState.data = profiles;
  profilesState.isPending = false;
  profilesState.isError = false;
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
});

describe('TasksTab — subtask nesting in the flat List view (AC-SUB-UI-001/002)', () => {
  it('AC-SUB-UI-001: a 3-level chain renders parent-then-children in order, indented by depth', () => {
    listState.data = [
      t('gp', 'Grandparent task'),
      t('p', 'Parent task', 'gp'),
      t('c', 'Child task', 'p'),
    ];
    renderTab();

    // Render order: grandparent, then parent, then child (DOM order == depth-first order).
    // The activation button's accessible name ("Edit <name>") is unambiguous per row.
    const buttonNames = screen
      .getAllByRole('button', { name: /^Edit /i })
      .map((b) => b.getAttribute('aria-label'));
    const gpIdx = buttonNames.indexOf('Edit Grandparent task');
    const pIdx = buttonNames.indexOf('Edit Parent task');
    const cIdx = buttonNames.indexOf('Edit Child task');
    expect(gpIdx).toBeGreaterThanOrEqual(0);
    expect(gpIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(cIdx);

    // Indentation strictly increases with depth: grandparent(0) < parent(1) < child(2).
    const gpIndent = parseInt(screen.getByText('Grandparent task').style.paddingLeft || '0', 10);
    const pIndent = parseInt(screen.getByText('Parent task').style.paddingLeft || '0', 10);
    const cIndent = parseInt(screen.getByText('Child task').style.paddingLeft || '0', 10);
    expect(gpIndent).toBe(0);
    expect(pIndent).toBeGreaterThan(gpIndent);
    expect(cIndent).toBeGreaterThan(pIndent);
  });

  it('AC-SUB-UI-002: a top-level task with no subtasks renders alone, unindented', () => {
    listState.data = [t('lonely', 'Lonely task')];
    renderTab();
    expect(screen.getByText('Lonely task').style.paddingLeft || '0').toBe('0');
  });
});

describe('TasksTab — parent-task picker excludes self + descendants (AC-SUB-UI-003)', () => {
  const openEditFor = async (taskName: string) => {
    const row = screen.getByText(taskName).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /edit/i }));
    return screen.findByRole('dialog');
  };

  it('AC-SUB-UI-003: editing the middle task of a chain excludes itself and its descendant from the parent options, but keeps unrelated tasks and its own current parent', async () => {
    listState.data = [
      t('gp', 'Grandparent task'),
      t('p', 'Parent task', 'gp'),
      t('c', 'Child task', 'p'),
      t('other', 'Unrelated task'),
    ];
    renderTab();
    const dialog = await openEditFor('Parent task');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /parent task/i }));

    // Valid candidates: its own current parent (gp) and an unrelated sibling.
    expect(await screen.findByRole('option', { name: /grandparent task/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /unrelated task/i })).toBeInTheDocument();

    // Invalid: itself, and its own descendant (would create a cycle).
    expect(screen.queryByRole('option', { name: /^parent task$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /child task/i })).not.toBeInTheDocument();
  });
});

describe('TasksTab — a subtask whose parent is outside the current milestone group (AC-SUB-UI-004)', () => {
  it('AC-SUB-UI-004: a subtask grouped under a DIFFERENT milestone than its parent still renders (not vanished), unindented in its own group', () => {
    const m1: MilestoneWithProgress = {
      id: 'm1', project_id: 'p1', name: 'Design', sort_order: 0,
      target_date: null, weight: 1, input_pct: null, task_count: 1,
      calculated_pct: 0, effective_pct: 0,
    };
    const m2: MilestoneWithProgress = {
      id: 'm2', project_id: 'p1', name: 'Procurement', sort_order: 1,
      target_date: null, weight: 1, input_pct: null, task_count: 1,
      calculated_pct: 0, effective_pct: 0,
    };
    milestoneState.data = [m1, m2];
    listState.data = [
      t('p1t', 'Design review', null, 'm1'),
      // Its subtask is grouped under m2 — a different milestone than its parent.
      t('c1t', 'Order steel', 'p1t', 'm2'),
    ];
    renderTab();

    const designSection = screen.getByRole('region', { name: /^Design$/i });
    expect(within(designSection).getByText('Design review')).toBeInTheDocument();
    expect(within(designSection).queryByText('Order steel')).toBeNull();

    // The subtask is NOT lost — it renders in its own (Procurement) group.
    const procurementSection = screen.getByRole('region', { name: /Procurement/i });
    expect(within(procurementSection).getByText('Order steel')).toBeInTheDocument();
    // Its parent isn't present in this slice, so it renders as a root: unindented.
    expect(screen.getByText('Order steel').style.paddingLeft || '0').toBe('0');
  });
});
