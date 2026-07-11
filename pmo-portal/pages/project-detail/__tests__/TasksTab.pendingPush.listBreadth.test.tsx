import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import { setTaskOwnership, clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';

/**
 * FR-CUA-070 breadth (review fix #4) — the per-task pending-push badge must surface on EVERY view
 * whose control can originate the write, not just the Board. This graduation test pins the LIST view:
 * with tasks externally-owned and a push-failed state seeded in `pendingPushByTask`, the badge is
 * VISIBLE in the list row (the status cell is a write origin). The Board-only regression is caught.
 */

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

// Controlled pending-push state — the graduation proof seeds a push-failed entry directly.
const pushState: { current: Record<string, PendingPushState> } = {
  current: {},
};

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({
    data: [
      {
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
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
    pendingPushByTask: pushState.current,
  }),
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
}));

import TasksTab from '../tabs/TasksTab';

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
  pushState.current = {};
});

afterEach(() => {
  clearOwnershipCache();
});

describe('TasksTab — pending-push badge breadth across write-origin views (FR-CUA-070, review fix #4)', () => {
  it('List view: an externally-owned task with a push-failed state shows the badge in the list row', async () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    pushState.current = {
      t1: { status: 'push-failed', error: { headline: 'external system unreachable — try again', detail: 'down' } },
    };
    renderTab();

    expect(await screen.findByText('Survey the site')).toBeInTheDocument();
    // The push-failed badge renders in the list row (not just the Board). role=status + the
    // classified headline's aria-label.
    expect(screen.getByRole('status', { name: /push failed/i })).toBeInTheDocument();
  });

  it('List view: no badge when the task is idle (no active/in-flight/failed push)', async () => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
    renderTab();
    expect(await screen.findByText('Survey the site')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /push/i })).not.toBeInTheDocument();
  });
});
