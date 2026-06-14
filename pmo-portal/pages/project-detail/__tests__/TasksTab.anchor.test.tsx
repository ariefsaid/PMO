/**
 * AC-JR-T25: TasksTab anchor scroll-into-view + transient highlight.
 *
 * When the URL hash is `#task-<id>`, TasksTab should:
 * 1. Render an id=`task-<id>` anchor on the matching task row.
 * 2. Call scrollIntoView() on the element after mount.
 * 3. Apply a transient highlight class that removes itself after the animation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { listState, milestoneState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  milestoneState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
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
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
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
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: realRole }),
}));

import TasksTab from '../tabs/TasksTab';

const seed = [
  {
    id: 'task-aaa',
    project_id: 'p1',
    name: 'Survey the site',
    status: 'To Do' as const,
    assignee_id: null,
    start_date: null,
    end_date: null,
    org_id: 'org-1',
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    assignee: null,
    dependencies: [],
  },
  {
    id: 'task-bbb',
    project_id: 'p1',
    name: 'Mobilise crew',
    status: 'In Progress' as const,
    assignee_id: null,
    start_date: null,
    end_date: null,
    org_id: 'org-1',
    milestone_id: null,
    created_at: '2026-02-01T00:00:00Z',
    assignee: null,
    dependencies: [],
  },
];

// Render with optional hash fragment
const renderTab = (hash = '') => {
  realRole = 'Project Manager';
  return render(
    <MemoryRouter initialEntries={[`/projects/p1/tasks${hash}`]}>
      <Routes>
        <Route
          path="/projects/:projectId/tasks"
          element={
            <ToastProvider>
              <TasksTab projectId="p1" />
            </ToastProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  milestoneState.data = [];
  milestoneState.isPending = false;
  milestoneState.isError = false;
  realRole = 'Project Manager';
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
});

// ── AC-JR-T25: anchor id on task rows ─────────────────────────────────────────

describe('AC-JR-T25: TasksTab renders id=task-<id> anchor on each task row', () => {
  it('AC-JR-T25: each task row element has id="task-<taskId>"', () => {
    renderTab();
    // The task row (or its wrapper) must have an id so the hash anchor works
    expect(document.getElementById('task-task-aaa')).toBeInTheDocument();
    expect(document.getElementById('task-task-bbb')).toBeInTheDocument();
  });

  it('AC-JR-T25: anchor id is present even without a hash in the URL', () => {
    renderTab();
    // Anchors must always be present so back-navigation from MyTasks always works
    const el = document.getElementById('task-task-aaa');
    expect(el).not.toBeNull();
  });
});

// ── AC-JR-T25: scrollIntoView called for matched anchor ───────────────────────

describe('AC-JR-T25: when URL has #task-<id>, TasksTab scrolls the row into view', () => {
  it('AC-JR-T25: scrollIntoView is called on the matched task element', async () => {
    const scrollIntoView = vi.fn();
    // We need to patch scrollIntoView before render
    const origScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      await act(async () => {
        renderTab('#task-task-aaa');
      });

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = origScrollIntoView;
    }
  });
});

// ── AC-JR-T25: transient highlight class ─────────────────────────────────────

describe('AC-JR-T25: matched task row receives a transient highlight', () => {
  it('AC-JR-T25: the highlighted task row has the task-highlight class initially', async () => {
    await act(async () => {
      renderTab('#task-task-aaa');
    });

    const el = document.getElementById('task-task-aaa');
    expect(el).not.toBeNull();
    // Should have some highlight indicator (class or data attribute)
    // The exact class name is determined by implementation — check for data-highlighted or a ring class
    await waitFor(() => {
      const elem = document.getElementById('task-task-aaa');
      expect(
        elem?.classList.contains('task-highlight') ||
        elem?.hasAttribute('data-highlighted') ||
        elem?.className.includes('ring') ||
        elem?.className.includes('highlight'),
      ).toBe(true);
    });
  });
});
