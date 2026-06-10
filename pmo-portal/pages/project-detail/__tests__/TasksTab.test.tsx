import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Repository-seam-backed hooks are mocked; the tab is the unit under test. ──
const { listState, profilesState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  profilesState: { data: [] as unknown[], isPending: false, isError: false },
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
    start_date: null,
    end_date: null,
    org_id: 'org-1',
    created_at: '2026-02-01T00:00:00Z',
    assignee: { id: 'pm-1', full_name: 'Pat Manager' },
    dependencies: [{ depends_on_id: 't1' }],
  },
];

const renderTab = (role: Role = 'Project Manager', userId = 'pm-1') => {
  realRole = role;
  currentUserId = userId;
  return render(
    <ToastProvider>
      <TasksTab projectId="p1" />
    </ToastProvider>,
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
});

describe('TasksTab — list (AC-TASK-001)', () => {
  it('AC-TASK-001: renders seeded task rows with name + status + assignee', () => {
    renderTab();
    expect(screen.getAllByText('Survey the site')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Mobilise crew')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Dana Engineer').length).toBeGreaterThan(0);
    // A manager (PM) sees an editable status control per row, reflecting each task's status.
    const t1Status = screen.getAllByLabelText(/status for survey the site/i)[0] as HTMLSelectElement;
    const t2Status = screen.getAllByLabelText(/status for mobilise crew/i)[0] as HTMLSelectElement;
    expect(t1Status.value).toBe('To Do');
    expect(t2Status.value).toBe('In Progress');
  });

  it('AC-TASK-001: loading state renders the skeleton (no rows)', () => {
    listState.isPending = true;
    listState.data = [];
    renderTab();
    expect(screen.getAllByTestId('liststate-loading')[0]).toBeInTheDocument();
    expect(screen.queryByText('Survey the site')).not.toBeInTheDocument();
  });

  it('AC-TASK-001: error state renders a retry affordance', async () => {
    listState.isError = true;
    listState.data = [];
    renderTab();
    expect(screen.getAllByText(/couldn't load tasks/i)[0]).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('AC-TASK-001: empty state teaches + offers a gated New task action', () => {
    listState.data = [];
    renderTab('Project Manager');
    expect(screen.getAllByText(/no tasks yet/i)[0]).toBeInTheDocument();
    // PM can create → the empty-state action is present
    expect(screen.getAllByRole('button', { name: /new task/i }).length).toBeGreaterThan(0);
  });

  it('AC-TASK-001: empty state for a read-only role shows no create action', () => {
    listState.data = [];
    renderTab('Finance');
    expect(screen.getAllByText(/no tasks yet/i)[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
  });
});

describe('TasksTab — gating (rbac-visibility §F)', () => {
  it('AC-TASK-003 gate: PM sees the New task button', () => {
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
  });

  it('AC-TASK-003 gate: Finance (read-only on Tasks) does NOT see New task', () => {
    renderTab('Finance');
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
  });

  it('AC-TASK-005 gate: Engineer assigned to t1 can change ITS status (own task)', () => {
    // Engineer eng-1 owns t1; the status control on t1 must be enabled.
    renderTab('Engineer', 'eng-1');
    const statusCtl = screen.getAllByLabelText(/status for survey the site/i)[0];
    expect(statusCtl).toBeEnabled();
  });

  it('AC-TASK-005 gate: Engineer NOT assigned cannot change another task status (t2 read-only)', () => {
    renderTab('Engineer', 'eng-1');
    // t2 is assigned to pm-1, not the engineer → its status is a static pill (no control).
    expect(screen.queryByLabelText(/status for mobilise crew/i)).not.toBeInTheDocument();
  });

  it('AC-TASK-003/004 gate: Engineer sees NO New task and NO row edit/delete menu', () => {
    renderTab('Engineer', 'eng-1');
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
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
    const statusCtl = screen.getAllByLabelText(/status for survey the site/i)[0];
    await userEvent.selectOptions(statusCtl, 'Done');
    await waitFor(() => expect(mutations.updateStatus.mutateAsync).toHaveBeenCalledWith({ id: 't1', status: 'Done' }));
    // The status-only path must never call the structure update.
    expect(mutations.update.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('TasksTab — delete (AC-TASK-006)', () => {
  it('AC-TASK-006: PM deletes a task through a destructive confirm', async () => {
    renderTab('Project Manager');
    const row = screen.getAllByText('Survey the site')[0].closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: /delete task/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('t1'));
  });
});

describe('TasksTab — edit structure (AC-TASK-004)', () => {
  const openEditFor = async (taskName: string) => {
    const row = screen.getAllByText(taskName)[0].closest('tr')!;
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
    const row = screen.getAllByText(taskName)[0].closest('tr')!;
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
