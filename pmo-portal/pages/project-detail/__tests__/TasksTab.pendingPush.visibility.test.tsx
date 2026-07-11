import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import { clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

/**
 * AC-CUA-061 — PMO-owned task surfaces stay byte-for-byte: no `pushing`/`pushed`/`push-failed`
 * badge appears on any write surface (list / board / edit-modal) when tasks are PMO-owned
 * (`routeTaskWrite() === 'pmo'`, the fail-closed default). The badge wires in ONLY for externally-
 * owned orgs (C8). Exercises the REAL `useTaskMutations` + REAL `TasksTab`; the ownership cache is
 * left empty (fail-closed 'pmo') so no pending-push state is ever produced.
 */

const { taskRepo, taskState } = vi.hoisted(() => ({
  taskRepo: {
    list: vi.fn(),
    updateStatus: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
  },
  taskState: { current: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    task: taskRepo,
    profile: { listOrgProfiles: vi.fn(async () => []) },
  },
}));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

import TasksTab from '../tabs/TasksTab';

const seedTask = {
  id: 't1',
  project_id: 'p1',
  name: 'Survey the site',
  status: 'To Do',
  assignee_id: 'eng-1',
  start_date: null,
  end_date: null,
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  assignee: { id: 'eng-1', full_name: 'Dana Engineer' },
  dependencies: [],
};

const renderTab = () => {
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/p1/tasks']}>
        <ToastProvider>
          <TasksTab projectId="p1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** No TaskPushBadge (role="status" named push*) may be present anywhere in the document. */
const expectNoPushBadge = () => {
  expect(screen.queryByRole('status', { name: /push/i })).not.toBeInTheDocument();
};

beforeEach(() => {
  taskState.current = [{ ...seedTask }];
  for (const [k, m] of Object.entries(taskRepo)) {
    (m as ReturnType<typeof vi.fn>).mockReset();
    if (k === 'list') {
      (m as ReturnType<typeof vi.fn>).mockImplementation(async () => taskState.current);
    } else {
      (m as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    }
  }
  // Fail-closed default: an empty cache ⇒ routeTaskWrite() === 'pmo' (PMO-owned).
  clearOwnershipCache();
});

afterEach(() => {
  clearOwnershipCache();
});

describe('TasksTab — PMO-owned surfaces stay badge-free (AC-CUA-061)', () => {
  it('AC-CUA-061: a list-view status write renders no push badge', async () => {
    renderTab();
    await screen.findByText('Survey the site');
    expectNoPushBadge();
    const statusCtl = screen.getByLabelText(/status for survey the site/i) as HTMLSelectElement;
    await userEvent.selectOptions(statusCtl, 'Done');
    await waitFor(() => expect(taskRepo.updateStatus).toHaveBeenCalledWith('t1', 'Done'));
    expectNoPushBadge();
  });

  it('AC-CUA-061: a board-view status write renders no push badge', async () => {
    renderTab();
    await screen.findByText('Survey the site');
    await userEvent.click(await screen.findByRole('tab', { name: /^board$/i }));
    const statusCtl = screen.getByLabelText(/status for survey the site/i) as HTMLSelectElement;
    await userEvent.selectOptions(statusCtl, 'Done');
    await waitFor(() => expect(taskRepo.updateStatus).toHaveBeenCalledWith('t1', 'Done'));
    expectNoPushBadge();
  });

  it('AC-CUA-061: an edit-modal save renders no push badge', async () => {
    renderTab();
    await screen.findByText('Survey the site');
    const row = screen.getByText('Survey the site').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText(/task name/i));
    await userEvent.type(within(dialog).getByLabelText(/task name/i), 'Survey the perimeter');
    await userEvent.click(within(dialog).getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(taskRepo.update).toHaveBeenCalled());
    expectNoPushBadge();
  });
});
