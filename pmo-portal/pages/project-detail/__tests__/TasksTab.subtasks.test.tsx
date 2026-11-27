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
import { MemoryRouter } from 'react-router';
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
    createTree: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
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
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';

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
    clearOwnershipCache();
    setTaskOwnership([]);
    setProjectBindings([]);
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

/** A phase's heading row and the text of every row up to the next phase heading (B7: phases share one table). */
function phase(name: RegExp) {
  const rows = within(screen.getByRole('table', { name: 'Project tasks' })).getAllByRole('row');
  const start = rows.findIndex((row) => within(row).queryByRole('rowheader', { name }));
  if (start === -1) throw new Error(`No phase heading ${name}`);
  const next = rows.findIndex((row, index) => index > start && within(row).queryByRole('rowheader'));
  return { heading: rows[start], text: rows.slice(start, next === -1 ? undefined : next).map((row) => row.textContent).join(' | ') };
}

describe('TasksTab — subtask nesting in the flat List view (AC-SUB-UI-001/002)', () => {
  it('AC-SUB-UI-001: a 3-level chain renders parent-then-children in order, each announced at its depth', async () => {
    listState.data = [
      t('gp', 'Grandparent task'),
      t('p', 'Parent task', 'gp'),
      t('c', 'Child task', 'p'),
    ];
    renderTab();

    // Render order: grandparent, then parent, then child (DOM order == depth-first order).
    // The redesigned list uses "Open task <name>" for its keyboard activation control.
    const buttonNames = screen
      .getAllByRole('button', { name: /^Open task /i })
      .map((b) => b.getAttribute('aria-label'));
    const gpIdx = buttonNames.indexOf('Open task Grandparent task');
    const pIdx = buttonNames.indexOf('Open task Parent task');
    const cIdx = buttonNames.indexOf('Open task Child task');
    expect(gpIdx).toBeGreaterThanOrEqual(0);
    expect(gpIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(cIdx);

    // Each level is announced with its depth (the indent is presentation; the level is the behaviour).
    const rowOf = (name: string) => screen.getByRole('button', { name: `Open task ${name}` }).closest('tr')!;
    expect(rowOf('Grandparent task').textContent).not.toMatch(/Subtask, level/);
    expect(rowOf('Parent task').textContent).toContain('Subtask, level 1');
    expect(rowOf('Child task').textContent).toContain('Subtask, level 2');
    // #2807: the fold toggle sits beside the open-task button, never inside it (one control per press).
    expect(screen.getByRole('button', { name: 'Open task Grandparent task' })
      .contains(screen.getByRole('button', { name: 'Hide subtasks of Grandparent task' }))).toBe(false);
    // #2807: a parent folds its subtasks and unfolds them again.
    await userEvent.click(screen.getByRole('button', { name: 'Hide subtasks of Grandparent task' }));
    expect(screen.queryByRole('button', { name: 'Open task Child task' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show subtasks of Grandparent task' }));
    expect(screen.getByRole('button', { name: 'Open task Child task' })).toBeInTheDocument();
  });

  it('AC-SUB-UI-002: a top-level task with no subtasks renders alone, unindented', () => {
    listState.data = [t('lonely', 'Lonely task')];
    renderTab();
    const row = screen.getByRole('button', { name: 'Open task Lonely task' }).closest('tr')!;
    expect(row.textContent).not.toMatch(/Subtask, level/);
    expect(within(row).queryByRole('button', { name: /subtasks of/ })).not.toBeInTheDocument();
  });
});

describe('TasksTab — Move offers no parent that would make a cycle (AC-SUB-UI-003)', () => {
  it('clears the work order filter so tasks return', async () => {
    listState.data = [{ ...t('p', 'Order task'), work_order_id: 'wo' }];
    renderTab();
    await userEvent.selectOptions(screen.getByLabelText('Filter by work order'), 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Order task')).toBeInTheDocument();
  });
  it('reports a partially moved branch and retries only its failed children', async () => {
    listState.data = [t('p', 'Parent task'), t('c', 'Child task', 'p'), t('d', 'Other child', 'p')];
    milestoneState.data = [{ id: 'm', name: 'New phase', task_count: 0, calculated_pct: 0, effective_pct: 0 }];
    mutations.update.mutateAsync.mockImplementation(async ({ id }) => { if (id === 'c') throw new Error('Connection lost'); });
    renderTab();
    const dialog = await openEditFor('Parent task');
    await userEvent.selectOptions(within(dialog).getByLabelText('Group'), 'm:m');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move', exact: true }));
    expect(await within(dialog).findByText(/Child task.*retry/i)).toBeInTheDocument();
    mutations.update.mutateAsync.mockResolvedValue(undefined);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move', exact: true }));
    const writes = mutations.update.mutateAsync.mock.calls.map(([input]) => input.id);
    expect(writes.filter((id) => id === 'p')).toHaveLength(1);
    expect(writes.filter((id) => id === 'd')).toHaveLength(1);
    expect(writes.filter((id) => id === 'c')).toHaveLength(2);
    expect(writes.at(-1)).toBe('c');
  });
  const openEditFor = async (taskName: string) => {
    const row = screen.getByText(taskName).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move…' }));
    return screen.findByRole('dialog');
  };

  it('AC-SUB-UI-003: moving the middle task of a chain offers neither itself nor its descendant, but keeps unrelated tasks and its own current parent', async () => {
    listState.data = [
      t('gp', 'Grandparent task'),
      t('p', 'Parent task', 'gp'),
      t('c', 'Child task', 'p'),
      t('other', 'Unrelated task'),
    ];
    renderTab();
    const dialog = await openEditFor('Parent task');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Under task' }));

    // Valid candidates: its own current parent (gp) and an unrelated sibling.
    expect(await screen.findByRole('option', { name: /grandparent task/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /unrelated task/i })).toBeInTheDocument();

    // Invalid: itself, and its own descendant (would create a cycle).
    expect(screen.queryByRole('option', { name: /^parent task$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /child task/i })).not.toBeInTheDocument();
  });
});

describe('TasksTab — a subtask whose parent is outside the current milestone group (AC-SUB-UI-004)', () => {
  it('AC-SUB-UI-004: a subtask in a different phase from its parent still renders, under its parent (a branch reads as one)', () => {
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
      // Its subtask carries another phase (#2807: it still counts there; it shows under its parent).
      t('c1t', 'Order steel', 'p1t', 'm2'),
    ];
    renderTab();

    const design = phase(/^Design/i);
    expect(design.text).toContain('Design review');
    expect(design.text).toContain('Subtask, level 1. Order steel');
  });
});

describe('TasksTab — subtasks are typed in the task form and saved with it (#2807)', () => {
  it('AC-SUB-UI-005: a new task with two subtasks, one with its own subtask, is saved in ONE tree write (no separate task, no parent picker)', async () => {
    listState.data = [t('x', 'Existing task')];
    renderTab();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'New task' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(dialog).queryByRole('combobox', { name: /parent task/i })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/task name/i), 'Foundations');
    const sub = within(dialog).getByRole('group', { name: 'Subtasks' });
    await user.click(within(sub).getByRole('button', { name: 'Add subtask' }));
    await user.click(within(sub).getByRole('button', { name: 'Add subtask' }));
    const names = () => within(sub).getAllByRole('textbox', { name: 'Subtask name' });
    await user.type(names()[0], 'Excavate');
    await user.type(names()[1], 'Pour');
    await user.click(within(sub).getByRole('button', { name: 'Add a subtask under Pour' }));
    await user.type(names()[2], 'Rebar');
    // A task with subtasks takes its status and dates from them, and the form says so instead of asking.
    expect(within(dialog).getByText('Status and dates come from its subtasks.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: /^status/i })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));

    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
    expect(mutations.createTree.mutateAsync).toHaveBeenCalledTimes(1);
    const [root, parentId, drafts] = mutations.createTree.mutateAsync.mock.calls[0][0];
    expect(root).toMatchObject({ name: 'Foundations', parent_task_id: null, project_id: 'p1' });
    expect(parentId).toBeNull();
    expect(drafts.map((d: { name: string }) => d.name)).toEqual(['Excavate', 'Pour']);
    expect(drafts[1].children.map((d: { name: string }) => d.name)).toEqual(['Rebar']);
  });

  it('AC-SUB-UI-006: a parent row shows its roll-up (progress of its subtasks) and no money; an Engineer sees no amount', () => {
    realRole = 'Engineer';
    currentUserId = 'eng-1';
    // An Engineer's list opens on their own tasks.
    const mine = { assignee_id: 'eng-1' };
    listState.data = [
      { ...t('p', 'Parent task'), ...mine },
      { ...t('a', 'Leaf A', 'p'), ...mine, status: 'Done', end_date: '2026-03-10' },
      { ...t('b', 'Leaf B', 'p'), ...mine, end_date: '2026-03-20' },
    ];
    renderTab();
    const row = screen.getByRole('button', { name: 'Open task Parent task' }).closest('tr')!;
    expect(within(row).getByRole('progressbar', { name: 'Subtask progress' })).toHaveAttribute('aria-valuenow', '50');
    // Price and cost visibility unchanged: the outline carries no amount for any role.
    const table = screen.getByRole('table', { name: 'Project tasks' });
    expect(table.textContent).not.toMatch(/IDR|USD|Rp\s?\d|\$\s?\d/);
  });
});
