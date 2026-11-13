import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { toast as sonnerToast } from 'sonner';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Same harness as TasksTab.rowclick.test.tsx — the real TasksTab + toolbar; reads and
// task writes are faked.
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
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => <div>Task comments</div> }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => <div>Task history</div> }));

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

const profiles = [
  { id: 'eng-1', full_name: 'Dana Engineer', role: 'Engineer' },
  { id: 'pm-1', full_name: 'Pat Manager', role: 'Project Manager' },
];

const task = (id: string, name: string) => ({
  id, project_id: 'p1', name, status: 'To Do', assignee_id: 'eng-1',
  start_date: null, end_date: '2026-06-20', org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  assignee: { id: 'eng-1', full_name: 'Dana Engineer' },
  dependencies: [],
});

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

afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});

beforeEach(() => {
  clearOwnershipCache();
  setTaskOwnership([]);
  setProjectBindings([]);
  listState.data = [task('t1', 'Survey the site'), task('t2', 'Pour foundations')];
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

const selectBoth = async () => {
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select task Survey the site' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select task Pour foundations' }));
};

describe('TasksTab floor — bulk actions', () => {
  it('floor: Bulk Change status sends the chosen status for every selected task', async () => {
    renderTab();
    await selectBoth();

    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await userEvent.selectOptions(screen.getByLabelText('New status for selected tasks'), 'In Progress');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mutations.updateStatus.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutations.updateStatus.mutateAsync).toHaveBeenCalledWith({ id: 't1', status: 'In Progress' });
    expect(mutations.updateStatus.mutateAsync).toHaveBeenCalledWith({ id: 't2', status: 'In Progress' });
  });

  it('floor: Bulk due date change sends the entered date to every selected task', async () => {
    renderTab();
    await selectBoth();

    await userEvent.click(screen.getByRole('button', { name: 'Change due date' }));
    await userEvent.type(screen.getByLabelText('Due date for selected tasks'), '2026-07-15');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mutations.update.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: 't1', patch: { end_date: '2026-07-15' } });
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: 't2', patch: { end_date: '2026-07-15' } });
  });

  it('floor: a failed bulk row stays selected and reports the partial failure', async () => {
    mutations.updateStatus.mutateAsync
      .mockRejectedValueOnce(new Error('blocked by workflow'))
      .mockResolvedValueOnce(undefined);
    renderTab();
    await selectBoth();

    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await userEvent.selectOptions(screen.getByLabelText('New status for selected tasks'), 'In Progress');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await findToastAnnouncement('alert', /updated; 1 failed/i);
    // The failed row's selection survives so the person can retry exactly what failed.
    expect(screen.getByRole('checkbox', { name: 'Select task Survey the site' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select task Pour foundations' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });
});
