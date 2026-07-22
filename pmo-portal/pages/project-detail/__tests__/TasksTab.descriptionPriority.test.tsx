/**
 * OD-INT-9 — the task form surfaces `description` (multi-line) + `priority` (select over the four
 * enum values + an explicit unset option). Both round-trip: create, edit, reload. Priority is
 * nullable, so "no priority" stays expressible and clearable.
 *
 * AC-TASK-DESC-001  the Description textarea + Priority select render in the new-task modal.
 * AC-TASK-DESC-002  create submits both values (description trimmed; priority as the enum).
 * AC-TASK-DESC-003  priority defaults to unset → create submits priority: null.
 * AC-TASK-DESC-004  edit pre-fills the task's existing description + priority.
 * AC-TASK-DESC-005  priority can be CLEARED back to unset → update submits priority: null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const profiles = [{ id: 'pm-1', full_name: 'Pat Manager', role: 'Project Manager' }];

/** A seeded task carrying description + priority (for the edit pre-fill / clear tests). */
const seededTask = {
  id: 't1',
  project_id: 'p1',
  name: 'Pour the slab',
  status: 'To Do',
  assignee_id: null,
  start_date: null,
  end_date: null,
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  assignee: null,
  dependencies: [],
  description: '5m³ M30 mix, cured 7 days.',
  priority: 'High',
};

const renderTab = () => {
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
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

const openNewTaskModal = async () => {
  await userEvent.click(screen.getByRole('button', { name: /new task/i }));
  return screen.findByRole('dialog');
};

const openEditFor = async (taskName: string) => {
  const row = screen.getByText(taskName).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: /edit/i }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  listState.data = [seededTask];
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

describe('TasksTab — description + priority render in the form (AC-TASK-DESC-001)', () => {
  it('AC-TASK-DESC-001: the new-task modal renders a Description textarea and a Priority select', async () => {
    renderTab();
    const dialog = await openNewTaskModal();
    // Description is a multi-line textarea (not a single-line input).
    const desc = within(dialog).getByLabelText(/description/i);
    expect(desc.tagName).toBe('TEXTAREA');
    // Priority is a select with all four enum values + an explicit unset option.
    const priority = within(dialog).getByLabelText(/priority/i) as HTMLSelectElement;
    expect(priority.tagName).toBe('SELECT');
    const optionLabels = Array.from(priority.options).map((o) => o.textContent);
    // The four enum values are all present.
    expect(optionLabels).toEqual(expect.arrayContaining(['Urgent', 'High', 'Normal', 'Low']));
    // Defaults to unset (empty value).
    expect(priority.value).toBe('');
  });
});

describe('TasksTab — create submits description + priority (AC-TASK-DESC-002/003)', () => {
  it('AC-TASK-DESC-002: typing a description + selecting a priority submits both values', async () => {
    renderTab();
    const dialog = await openNewTaskModal();
    await userEvent.type(within(dialog).getByLabelText(/task name/i), 'Frame the walls');
    await userEvent.type(within(dialog).getByLabelText(/description/i), 'Use CLS 47x150mm.');
    await userEvent.selectOptions(within(dialog).getByLabelText(/priority/i), 'Urgent');
    await userEvent.click(within(dialog).getByRole('button', { name: /create task/i }));
    await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalled());
    const arg = mutations.create.mutateAsync.mock.calls[0][0];
    expect(arg).toMatchObject({
      name: 'Frame the walls',
      description: 'Use CLS 47x150mm.',
      priority: 'Urgent',
    });
  });

  it('AC-TASK-DESC-003: an unset priority + blank description submit as null (never invented)', async () => {
    renderTab();
    const dialog = await openNewTaskModal();
    await userEvent.type(within(dialog).getByLabelText(/task name/i), 'Bare task');
    // Leave description blank and priority unset.
    await userEvent.click(within(dialog).getByRole('button', { name: /create task/i }));
    await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalled());
    const arg = mutations.create.mutateAsync.mock.calls[0][0];
    expect(arg.description).toBeNull();
    expect(arg.priority).toBeNull();
  });
});

describe('TasksTab — edit pre-fills and clears description + priority (AC-TASK-DESC-004/005)', () => {
  it('AC-TASK-DESC-004: edit pre-fills the task’s existing description + priority', async () => {
    renderTab();
    const dialog = await openEditFor('Pour the slab');
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue('5m³ M30 mix, cured 7 days.');
    expect((within(dialog).getByLabelText(/priority/i) as HTMLSelectElement).value).toBe('High');
  });

  it('AC-TASK-DESC-005: clearing the priority back to unset submits priority: null in the update patch', async () => {
    renderTab();
    const dialog = await openEditFor('Pour the slab');
    // The seeded task is High; select the explicit unset option.
    const priority = within(dialog).getByLabelText(/priority/i) as HTMLSelectElement;
    await userEvent.selectOptions(priority, '');
    expect(priority.value).toBe('');
    await userEvent.click(within(dialog).getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const arg = mutations.update.mutateAsync.mock.calls[0][0];
    expect(arg.id).toBe('t1');
    expect(arg.patch.priority).toBeNull();
  });

  it('AC-TASK-DESC-005b: editing the description submits the new value in the update patch', async () => {
    renderTab();
    const dialog = await openEditFor('Pour the slab');
    const desc = within(dialog).getByLabelText(/description/i);
    await userEvent.clear(desc);
    await userEvent.type(desc, 'Revised: 6m³, M35 mix.');
    await userEvent.click(within(dialog).getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const arg = mutations.update.mutateAsync.mock.calls[0][0];
    expect(arg.patch.description).toBe('Revised: 6m³, M35 mix.');
  });

  it('AC-TASK-DESC-005c: clearing the description submits description: null in the update patch', async () => {
    renderTab();
    const dialog = await openEditFor('Pour the slab');
    await userEvent.clear(within(dialog).getByLabelText(/description/i));
    await userEvent.click(within(dialog).getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const arg = mutations.update.mutateAsync.mock.calls[0][0];
    expect(arg.patch.description).toBeNull();
  });
});
