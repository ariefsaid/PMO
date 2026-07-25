import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import { setTaskOwnership, setProjectBindings, clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import { AppError } from '@/src/lib/appError';

/**
 * AC-CUA-060 — the per-task pending-push surface on the REAL TasksTab (board mode). Exercises the
 * REAL `useTaskMutations` pending-push derivation + the REAL `TasksTab` badge rendering; only the
 * repository seam (`repositories.task.*`) + auth + the ADR-0056 ownership cache are controlled, so
 * the pushing→pushed and push-failed+revert behaviours are asserted end-to-end at the unit layer.
 *
 * The cache is set to `{ tasks: 'clickup' }` (externally-owned) so `routeTaskWrite()` returns
 * `'external'` and the badge wires in. FR-CUA-060/062.
 */

// ── Repository seam stub (only the task + profile members TasksTab reaches). ──
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
// Milestones stub — empty so the flat/board views are used (no milestone grouping).
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
});

afterEach(() => {
  clearOwnershipCache();
});

const switchToBoard = async () => {
  await userEvent.click(await screen.findByRole('tab', { name: /^board$/i }));
};

describe('TasksTab — pending-push badge (AC-CUA-060)', () => {
  it('AC-CUA-060: an externally-owned board status write shows pushing → pushed', async () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    setProjectBindings([{ projectId: 'p1', externalTier: 'clickup' }]);
    renderTab();
    await switchToBoard();

    const statusCtl = screen.getByLabelText(/status for survey the site/i) as HTMLSelectElement;
    expect(statusCtl.value).toBe('To Do');

    // Hold the dispatch in-flight so the `pushing` badge is observable, and mutate the read-model
    // state so the post-success refetch reflects the mirrored status (the card settles to Done).
    let resolveUpdate!: (v: unknown) => void;
    taskRepo.updateStatus.mockImplementation(async (id: string, status: string) => {
      taskState.current = taskState.current.map((t) => (t.id === id ? { ...t, status } : t));
      return new Promise((r) => {
        resolveUpdate = r;
      });
    });

    await userEvent.selectOptions(statusCtl, 'Done');

    // While the dispatch is in-flight: the `pushing` badge is rendered.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /pushing/i })).toBeInTheDocument(),
    );

    // The dispatch commits → `pushed`; the read-model refetch settles the card to Done.
    resolveUpdate({ id: 't1', status: 'Done' });
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /pushed/i })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/status for survey the site/i) as HTMLSelectElement).value,
      ).toBe('Done'),
    );
  });

  it('AC-CUA-060: a rejected dispatch shows push-failed and the card reverts to the prior status', async () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    setProjectBindings([{ projectId: 'p1', externalTier: 'clickup' }]);
    renderTab();
    await switchToBoard();

    const statusCtl = screen.getByLabelText(/status for survey the site/i) as HTMLSelectElement;
    taskRepo.updateStatus.mockRejectedValue(
      new AppError('ClickUp did not respond', 'external-unreachable'),
    );

    await userEvent.selectOptions(statusCtl, 'Done');

    // The dispatch rejected → `push-failed` badge with the classified headline.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /push failed/i })).toBeInTheDocument(),
    );

    // No optimistic update + no invalidation on failure → the controlled select reverts to the
    // prior read-model status (To Do), exactly as the card was before the attempted write.
    expect(
      (screen.getByLabelText(/status for survey the site/i) as HTMLSelectElement).value,
    ).toBe('To Do');
  });
});
