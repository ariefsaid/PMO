import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Repository-seam-backed hooks are mocked; the tab is the unit under test. ──
const { listState, profilesState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  profilesState: { data: [] as unknown[], isPending: false, isError: false },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  },
}));

const integrationsState = vi.hoisted(() => ({
  clickupLists: [] as unknown[],
  isListsPending: false,
  isListsError: false,
  listsError: null as unknown,
  refetchLists: vi.fn(),
  linkProject: { mutateAsync: vi.fn().mockResolvedValue({ ok: true }), isPending: false },
  unlinkProject: { mutateAsync: vi.fn().mockResolvedValue({ ok: true }), isPending: false },
  projectBindings: [] as unknown[],
  isBindingsPending: false,
  isBindingsError: false,
  bindingsError: null as unknown,
  refetchBindings: vi.fn(),
  getBinding: vi.fn(),
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => listState,
  useAssignableProfiles: () => profilesState,
  useTaskMutations: () => mutations,
}));
// Milestones stub — empty so the flat list view is used (no grouping) in these tests.
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useIntegrations', () => ({
  useIntegrations: () => integrationsState,
}));

// usePermission reads the REAL JWT role from the impersonation context.
let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

// The current user id drives the Engineer own-task gating.
let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));

import TasksTab from '../tabs/TasksTab';

const profiles = [
  { id: 'eng-1', full_name: 'Dana Engineer', role: 'Engineer' },
  { id: 'pm-1', full_name: 'Pat Manager', role: 'Project Manager' },
];

const seed = [
  {
    id: 't1',
    project_id: 'p1',
    name: 'Survey the site',
    status: 'To Do',
    assignee_id: 'eng-1',
    created_by: 'pm-1', // ⚑ asymmetric on purpose: assignee ≠ creator, or the two rights are indistinguishable
    start_date: null,
    end_date: '2026-06-20',
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    assignee: { id: 'eng-1', full_name: 'Dana Engineer' },
    dependencies: [],
  },
  {
    id: 't2',
    project_id: 'p1',
    name: 'Mobilise crew',
    status: 'In Progress',
    assignee_id: 'pm-1',
    created_by: 'eng-1', // the Engineer-created row (assigned to the PM) — DD-TASK-8's fixture shape
    start_date: null,
    end_date: null,
    org_id: 'org-1',
    created_at: '2026-02-01T00:00:00Z',
    assignee: { id: 'pm-1', full_name: 'Pat Manager' },
    dependencies: [{ depends_on_id: 't1' }],
  },
  {
    id: 't3', project_id: 'p1', name: 'Archived obsolete work', status: 'In Progress',
    assignee_id: null, start_date: null, end_date: null, archived_at: '2026-06-01T00:00:00Z',
    org_id: 'org-1', created_at: '2026-03-01T00:00:00Z', assignee: null, dependencies: [],
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
  listState.refetch.mockClear();
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
  integrationsState.clickupLists = [];
  integrationsState.isListsPending = false;
  integrationsState.isListsError = false;
  integrationsState.listsError = null;
  integrationsState.linkProject.mutateAsync.mockClear();
  integrationsState.unlinkProject.mutateAsync.mockClear();
  integrationsState.projectBindings = [];
  integrationsState.isBindingsPending = false;
  integrationsState.isBindingsError = false;
  integrationsState.bindingsError = null;
  integrationsState.getBinding.mockImplementation(() => undefined);
});

describe('Project detail task toolbar and ordering', () => {
  it('AC-PD-TASK-01 orders search, scope and status filters, due sort, views, secondary action, then primary', () => {
    renderTab();
    const toolbar = screen.getByRole('group', { name: 'Task tools' });
    const orderedControls = [
      screen.getByRole('searchbox', { name: 'Search tasks' }),
      screen.getByRole('combobox', { name: 'Phase filter' }),
      screen.getByRole('combobox', { name: 'Status filter' }),
      screen.getByRole('combobox', { name: 'Sort tasks' }),
      screen.getByRole('group', { name: 'Task view' }),
      screen.getByRole('button', { name: 'Show archived' }),
      screen.getByRole('button', { name: 'New task' }),
    ];
    expect(orderedControls.every((control) => toolbar.contains(control))).toBe(true);
    for (let index = 0; index < orderedControls.length - 1; index += 1) {
      expect(orderedControls[index].compareDocumentPosition(orderedControls[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const task = screen.getByText('Survey the site');
    expect(toolbar.compareDocumentPosition(task) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-PD-TASK-02 keeps controls on no-match and clears search, phase and status filters', async () => {
    renderTab();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'missing task');
    expect(screen.getByText('No tasks match these filters')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Task tools' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getByText('Survey the site')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status filter' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Phase filter' })).toHaveValue('all');
  });

  it('AC-PD-TASK-03 sorts due dates while undated and completed tasks stay last and subtasks remain adjacent', async () => {
    listState.data = [
      { ...seed[0], end_date: '2026-06-20', parent_task_id: null },
      { ...seed[1], end_date: '2026-06-10', parent_task_id: null },
      { id: 't4', project_id: 'p1', name: 'Completed task', status: 'Done', assignee_id: null, created_by: 'pm-1', start_date: null, end_date: '2026-06-01', created_at: '2026-03-01T00:00:00Z', assignee: null, dependencies: [], parent_task_id: null },
      { id: 't5', project_id: 'p1', name: 'Subtask', status: 'To Do', assignee_id: null, created_by: 'pm-1', start_date: null, end_date: '2026-06-05', created_at: '2026-03-02T00:00:00Z', assignee: null, dependencies: [], parent_task_id: 't1' },
    ];
    renderTab();
    const table = screen.getByRole('table');
    let rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Mobilise crew'),
      expect.stringContaining('Survey the site'),
      expect.stringContaining('Subtask'),
      expect.stringContaining('Completed task'),
    ]);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort tasks' }), 'latest');
    rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Survey the site');
    expect(rows[1]).toHaveTextContent('Subtask');
    expect(rows[2]).toHaveTextContent('Mobilise crew');
    expect(rows[3]).toHaveTextContent('Completed task');
  });
});

describe('TasksTab — task-first ClickUp setup (AC-S21-001)', () => {
  it('SUB-F: a disconnected, unlinked ClickUp renders no card or prompt — just the task register', () => {
    renderTab();

    expect(screen.getByText('Survey the site')).toBeInTheDocument();
    expect(screen.queryByTestId('project-integrations-compact')).not.toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  });

  it('SUB-F: even an Admin sees no setup prompt on the Tasks tab (setup lives in Administration)', () => {
    renderTab('Admin');

    expect(screen.queryByRole('link', { name: /set up ClickUp/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Survey the site')).toBeInTheDocument();
  });

  it('keeps tasks first when a ClickUp project link already exists', () => {
    integrationsState.getBinding.mockImplementation((tier: string) => tier === 'clickup' ? { status: 'active' } : undefined);
    integrationsState.clickupLists = [{ id: 'list-1', name: 'Sprint Backlog', space_name: 'Delivery', folder_name: null }];
    integrationsState.projectBindings = [{
      id: 'binding-1', org_id: 'org-1', project_id: 'p1', external_tier: 'clickup',
      external_container_id: 'list-1', config: { direction: 'push-seed' }, linked_by: 'u1',
      linked_at: '2026-01-02T00:00:00Z', disconnected_at: null,
    }];

    renderTab();

    const task = screen.getByText('Survey the site');
    const linkedList = screen.getByText(/Linked to ClickUp list Sprint Backlog/);
    expect(task.compareDocumentPosition(linkedList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps task work usable ahead of the ClickUp recovery state when list loading fails', () => {
    integrationsState.getBinding.mockImplementation((tier: string) => tier === 'clickup' ? { status: 'active' } : undefined);
    integrationsState.isListsError = true;
    integrationsState.listsError = new Error('private transport diagnostic');

    renderTab();

    const task = screen.getByText('Survey the site');
    const recovery = screen.getByRole('button', { name: /^Retry$/i });
    expect(task.compareDocumentPosition(recovery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('private transport diagnostic')).not.toBeInTheDocument();
  });
});

describe('TasksTab — archive affordance (AC-CUA-098/099/100)', () => {
  it('AC-CUA-098: hides archived rows by default and Show archived reveals them', async () => {
    renderTab();
    expect(screen.queryByText('Archived obsolete work')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show archived' }));
    expect(screen.getByText('Archived obsolete work')).toBeInTheDocument();
  });

  it('AC-CUA-099: permitted manager gets Archive then Unarchive in the row menu', async () => {
    renderTab();
    await userEvent.click(screen.getAllByRole('button', { name: /Row actions/i })[0]);
    expect(screen.getByText('Archive')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Show archived'));
    const archivedRow = screen.getByText('Archived obsolete work').closest('tr')!;
    await userEvent.click(within(archivedRow).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByText('Unarchive')).toBeInTheDocument();
  });

  it('AC-CUA-100: archive action is absent while tasks are externally owned', async () => {
    const ownership = await import('@/src/lib/adapterSeam/ownershipCache');
    vi.spyOn(ownership, 'routeTaskWrite').mockReturnValue('external');
    renderTab();
    await userEvent.click(screen.getAllByRole('button', { name: /Row actions/i })[0]);
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });
});

describe('TasksTab — list (AC-TASK-001)', () => {
  it('AC-TASK-001: renders seeded task rows with name + status + assignee', () => {
    renderTab();
    expect(screen.getByText('Survey the site')).toBeInTheDocument();
    expect(screen.getByText('Mobilise crew')).toBeInTheDocument();
    expect(screen.getAllByText('Dana Engineer').length).toBeGreaterThan(0);
    // A manager (PM) sees an editable status control per row, reflecting each task's status.
    const t1Status = screen.getByLabelText(/status for survey the site/i) as HTMLSelectElement;
    const t2Status = screen.getByLabelText(/status for mobilise crew/i) as HTMLSelectElement;
    expect(t1Status.value).toBe('To Do');
    expect(t2Status.value).toBe('In Progress');
  });

  it('CW-7: the Due column renders the date human-formatted, never raw ISO', () => {
    renderTab();
    // t1 carries end_date '2026-06-20' → routed through formatDate (no raw ISO leak).
    expect(screen.getByText('Jun 20, 2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-06-20')).not.toBeInTheDocument();
  });

  it('AC-TASK-001: loading state renders the skeleton (no rows)', () => {
    listState.isPending = true;
    listState.data = [];
    renderTab();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByText('Survey the site')).not.toBeInTheDocument();
  });

  it('AC-TASK-001: error state renders a retry affordance', async () => {
    listState.isError = true;
    listState.data = [];
    renderTab();
    expect(screen.getByText(/couldn't load tasks/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('AC-TASK-001 (SUB-E): empty state shows one gated New task action (the header one) and no restating subtitle', () => {
    listState.data = [];
    renderTab('Project Manager');
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new task/i })).toHaveLength(1);
    expect(screen.queryByText('Plan, assign, and track the work for this project.')).toBeNull();
  });

  // ⚑ INVERTED BY the owner ruling of 2026-10-23 (migration 0355): Finance was the last role that
  // could not create a task; it is now scoped like an Engineer, so its empty state offers create.
  it('AC-TASK-001 + AC-TASK-FIN-001: Finance\'s empty state offers the one gated New task action', () => {
    listState.data = [];
    renderTab('Finance');
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new task/i })).toHaveLength(1);
  });
});

describe('TasksTab — gating (rbac-visibility §F)', () => {
  it('AC-TASK-003 gate: PM sees the New task button', () => {
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
  });

  // ⚑ INVERTED BY the owner ruling of 2026-10-23 (migration 0355): Finance is scoped exactly like an
  // Engineer — New task, Edit on rows it CREATED only, Delete/Archive nowhere, status on its own
  // assigned row only. Fixture ids are role-independent, so 'eng-1' here is a Finance user.
  it('AC-TASK-FIN-001 gate: Finance gets New task + Edit on THEIR row only, Delete nowhere, status on own assigned task', async () => {
    renderTab('Finance', 'eng-1');
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
    const own = screen.getByText('Mobilise crew').closest('tr')!;
    await userEvent.click(within(own).getByRole('button', { name: /row actions/i }));
    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /archive/i })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    const assigned = screen.getByText('Survey the site').closest('tr')!;
    expect(within(assigned).queryByRole('button', { name: /row actions/i })).not.toBeInTheDocument();
    // Status: own assigned task (t1) is a control; t2 (assigned to pm-1) is a static pill.
    expect(screen.getByLabelText(/status for survey the site/i)).toBeEnabled();
    expect(screen.queryByLabelText(/status for mobilise crew/i)).not.toBeInTheDocument();
  });

  it('AC-TASK-005 gate: Engineer assigned to t1 can change ITS status (own task)', () => {
    // Engineer eng-1 owns t1; the status control on t1 must be enabled.
    renderTab('Engineer', 'eng-1');
    const statusCtl = screen.getByLabelText(/status for survey the site/i);
    expect(statusCtl).toBeEnabled();
  });

  it('AC-TASK-005 gate: Engineer NOT assigned cannot change another task status (t2 read-only)', () => {
    renderTab('Engineer', 'eng-1');
    // t2 is assigned to pm-1, not the engineer → its status is a static pill (no control).
    expect(screen.queryByLabelText(/status for mobilise crew/i)).not.toBeInTheDocument();
  });

  // ⚑ INVERTED BY DD-TASK-8 (#551, migration 0204), then REWRITTEN after the 3-lens review: the
  // first inversion asserted `queryByRole('button', {name:/delete/i})` — which passes for a PM too,
  // because Delete lives inside a CLOSED row menu and is never a rendered button. An oracle that
  // passes for the role it exists to exclude is not an oracle. This one opens the menu.
  it('AC-TASK-003/004 gate (DD-TASK-8): Engineer gets New task + Edit on THEIR row only, Delete nowhere', async () => {
    renderTab('Engineer', 'eng-1');
    // The widened half: create is offered.
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
    // Their own creation (t2, created_by eng-1, assigned pm-1): menu opens, Edit yes, Delete no.
    const own = screen.getByText('Mobilise crew').closest('tr')!;
    await userEvent.click(within(own).getByRole('button', { name: /row actions/i }));
    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // A row they merely EXECUTE (t1, assignee eng-1, created by the PM): no menu at all — the
    // assignee's affordance is the status control, not Edit (RLS carries no assignee edit path).
    const assigned = screen.getByText('Survey the site').closest('tr')!;
    expect(within(assigned).queryByRole('button', { name: /row actions/i })).not.toBeInTheDocument();
  });
});

describe('TasksTab — create (AC-TASK-003)', () => {
  it('AC-TASK-003: opens the modal, fills the title, submits → calls create', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /new task/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/task name/i), 'Inspect equipment');
    await userEvent.click(within(dialog).getByRole('button', { name: /create task/i }));
    await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalled());
    const arg = mutations.create.mutateAsync.mock.calls[0][0];
    expect(arg).toMatchObject({ project_id: 'p1', name: 'Inspect equipment', status: 'To Do' });
  });

  it('AC-TASK-003: a blank required name keeps submit disabled (F8 readiness — no create fires)', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /new task/i }));
    const dialog = await screen.findByRole('dialog');
    // F8 (AC-IXD-FORM-F8): the blank required task name disables submit, so the user
    // cannot silently submit a blank task and no create mutation fires.
    const submit = within(dialog).getByRole('button', { name: /create task/i });
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('TasksTab — status update (AC-TASK-005)', () => {
  it('AC-TASK-005: an assignee Engineer changing status calls updateStatus (status-only path)', async () => {
    renderTab('Engineer', 'eng-1');
    const statusCtl = screen.getByLabelText(/status for survey the site/i);
    await userEvent.selectOptions(statusCtl, 'Done');
    await waitFor(() => expect(mutations.updateStatus.mutateAsync).toHaveBeenCalledWith({ id: 't1', status: 'Done' }));
    // The status-only path must never call the structure update.
    expect(mutations.update.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('TasksTab — delete (AC-TASK-006)', () => {
  it('AC-TASK-006: PM deletes a task through a destructive confirm', async () => {
    renderTab('Project Manager');
    const row = screen.getByText('Survey the site').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: /delete task/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('t1'));
  });
});

describe('TasksTab — edit structure (AC-TASK-004)', () => {
  const openEditFor = async (taskName: string) => {
    const row = screen.getByText(taskName).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /edit/i }));
    return screen.findByRole('dialog');
  };

  it('AC-TASK-004: a PM opens Edit pre-filled with the task name, renames it, and Save calls update', async () => {
    renderTab('Project Manager');
    const dialog = await openEditFor('Survey the site');
    const nameField = within(dialog).getByLabelText(/task name/i);
    expect(nameField).toHaveValue('Survey the site');
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Survey the perimeter');
    await userEvent.click(within(dialog).getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const arg = mutations.update.mutateAsync.mock.calls[0][0];
    expect(arg).toMatchObject({ id: 't1', patch: { name: 'Survey the perimeter' } });
    // The status-only path must NOT be used for a structure edit.
    expect(mutations.updateStatus.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('TasksTab — dependency add/remove (AC-TASK-004)', () => {
  const openEditFor = async (taskName: string) => {
    const row = screen.getByText(taskName).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /edit/i }));
    return screen.findByRole('dialog');
  };

  it('AC-TASK-004: adding a dependency edge then saving calls addDependency with the picked task', async () => {
    // Edit t1 (no existing deps). The only sibling candidate is t2 ("Mobilise crew").
    renderTab('Project Manager');
    const dialog = await openEditFor('Survey the site');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /add a dependency/i }));
    await userEvent.click(await screen.findByRole('option', { name: /mobilise crew/i }));
    // The picked dependency now appears as a removable chip in the Depends-on list
    // (the remove button carries the "Remove dependency …" accessible name).
    expect(
      within(dialog).getByRole('button', { name: /remove dependency mobilise crew/i }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /save task/i }));
    await waitFor(() =>
      expect(mutations.addDependency.mutateAsync).toHaveBeenCalledWith({ taskId: 't1', dependsOnId: 't2' }),
    );
    expect(mutations.removeDependency.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-TASK-004: removing an existing dependency then saving calls removeDependency for the dropped edge', async () => {
    // t2 depends on t1 ("Survey the site"). Remove that edge and save.
    renderTab('Project Manager');
    const dialog = await openEditFor('Mobilise crew');
    await userEvent.click(within(dialog).getByRole('button', { name: /remove dependency survey the site/i }));
    expect(
      within(dialog).queryByRole('button', { name: /remove dependency survey the site/i }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /save task/i }));
    await waitFor(() =>
      expect(mutations.removeDependency.mutateAsync).toHaveBeenCalledWith({ taskId: 't2', dependsOnId: 't1' }),
    );
    expect(mutations.addDependency.mutateAsync).not.toHaveBeenCalled();
  });
});
