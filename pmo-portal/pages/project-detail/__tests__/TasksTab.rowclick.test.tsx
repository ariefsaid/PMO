/**
 * AC-W6-IXD-TASKROW — clicking (or Enter-activating) a task row opens the EXISTING
 * Edit modal, pre-filled. The activation control's accessible name is "Edit <name>".
 * Clicking ⋯ → Delete does NOT open the edit modal (stopPropagation). A viewer who
 * cannot edit (Engineer on others' tasks) gets NO activation affordance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

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
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
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
];

const renderTab = (role: Role = 'Project Manager', userId = 'pm-1') => {
  realRole = role;
  currentUserId = userId;
  return render(
    <MemoryRouter initialEntries={['/projects/p1/tasks']}>
      <ToastProvider>
        <TasksTab projectId="p1" />
      </ToastProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
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

describe('TasksTab — row click opens the edit modal (AC-W6-IXD-TASKROW)', () => {
  it('AC-W6-IXD-TASKROW: clicking a task row opens the edit modal pre-filled with that task', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Survey the site' }));
    const dialog = await screen.findByRole('dialog', { name: /Edit task/i });
    expect(within(dialog).getByLabelText(/task name/i)).toHaveValue('Survey the site');
  });

  it('AC-W6-IXD-TASKROW: pressing Enter on the row activation button opens the edit modal', async () => {
    renderTab('Project Manager');
    const activation = screen.getByRole('button', { name: 'Edit Survey the site' });
    activation.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: /Edit task/i })).toBeInTheDocument();
  });

  it('AC-W6-IXD-TASKROW: the activation button accessible name is "Edit <task name>"', () => {
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: 'Edit Survey the site' })).toBeInTheDocument();
  });

  it('AC-W6-IXD-TASKROW: clicking ⋯ → Delete does NOT open the edit modal (stopPropagation)', async () => {
    renderTab('Project Manager');
    const row = screen.getByText('Survey the site').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    // A destructive confirm appears, not the edit dialog.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Edit task/i })).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-TASKROW: canEdit=false (Engineer) → the row is NOT activatable (no Edit affordance)', () => {
    renderTab('Engineer', 'eng-1');
    expect(screen.queryByRole('button', { name: 'Edit Survey the site' })).not.toBeInTheDocument();
  });
});
