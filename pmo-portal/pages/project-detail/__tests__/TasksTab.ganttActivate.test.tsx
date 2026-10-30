/**
 * AC-JR-T23: TasksTab wires ProjectGantt.onActivateTask so clicking a Gantt bar
 * opens the shared task drawer.
 *
 * This is the consumer test for the T22 seam (ProjectGantt.onActivateTask added
 * in jtbd-p0-shared). Bars in the Timeline view open the record drawer to readers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks (mirror TasksTab.timeline.test.tsx) ─────────────────────────────────

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
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));

import TasksTab from '../tabs/TasksTab';

// Tasks with dates so the Gantt has bars to click
const seed = [
  {
    id: 't1',
    project_id: 'p1',
    name: 'Survey the site',
    status: 'To Do' as const,
    assignee_id: null,
    start_date: '2026-01-01',
    end_date: '2026-01-15',
    org_id: 'org-1',
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    assignee: null,
    dependencies: [],
  },
  {
    id: 't2',
    project_id: 'p1',
    name: 'Mobilise crew',
    status: 'In Progress' as const,
    assignee_id: null,
    start_date: '2026-01-10',
    end_date: '2026-01-20',
    org_id: 'org-1',
    milestone_id: null,
    created_at: '2026-02-01T00:00:00Z',
    assignee: null,
    dependencies: [],
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
  milestoneState.data = [];
  milestoneState.isPending = false;
  milestoneState.isError = false;
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
});

// ── AC-JR-T23: Gantt bars are activatable ─────────────────────────────────────

describe('AC-JR-T23: TasksTab Gantt bars open the task drawer when clicked', () => {
  it('AC-JR-T23: switching to Timeline view shows the Gantt figure', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('figure')).toBeInTheDocument());
  });

  it('AC-JR-T23: clicking a Gantt bar (role=button) opens the shared task drawer', async () => {
    renderTab('Project Manager');
    // Switch to timeline view
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('figure')).toBeInTheDocument());

    // Bar has role=button (added by T22 seam when onActivateTask is provided)
    const bar = screen.getByRole('button', { name: /Survey the site/i });
    expect(bar).toBeInTheDocument();

    // Click the bar — it opens the record drawer.
    fireEvent.click(bar);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Survey the site' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('AC-JR-T23: drawer opened from a Gantt bar keeps full-record and edit actions', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('figure')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Survey the site/i }));

    const drawer = await screen.findByRole('dialog', { name: 'Survey the site' });
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('AC-JR-T23: Edit from the Gantt-opened drawer shows the pre-filled Edit task form', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('figure')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Survey the site/i }));
    const drawer = await screen.findByRole('dialog', { name: 'Survey the site' });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('dialog', { name: /Edit task/i });
    expect(within(form).getByDisplayValue('Survey the site')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: /save task/i })).toBeInTheDocument();
  });

  it('AC-1402 keeps Comments reachable from a Timeline row menu', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('figure')).toBeInTheDocument());
    const rowActions = screen.getAllByRole('button', { name: /Row actions/i })[0];
    await userEvent.click(rowActions);
    const menu = rowActions.closest('details')?.querySelector('[role="menu"]') as HTMLElement;
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Comments' }));
    expect(await screen.findByRole('dialog', { name: 'Survey the site' })).toBeInTheDocument();
  });

  it('AC-JR-T23: Finance can open the drawer but gets no Edit action for a task it did not create', async () => {
    renderTab('Finance');
    await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    await waitFor(() => expect(screen.getByRole('figure')).toBeInTheDocument());

    // Rows remain activatable for readers; structure editing stays role/creator gated.
    fireEvent.click(screen.getByRole('button', { name: /Survey the site/i }));
    const drawer = await screen.findByRole('dialog', { name: 'Survey the site' });
    expect(within(drawer).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Survey the site').length).toBeGreaterThan(0);
  });
});
