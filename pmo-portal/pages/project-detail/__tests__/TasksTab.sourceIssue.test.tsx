/**
 * JOB-F17: on the project's Tasks tab, a task that was made from an issue carries a link back to
 * that issue inside its `#task-<id>` anchor (the target of the My Tasks deep link); a plain task
 * carries none. Opening the issue never opens the task drawer (the row-activation guard skips links).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { listState, milestoneState, mutations, issues } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  milestoneState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  },
  issues: { map: new Map<string, string>() },
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => listState,
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => mutations,
}));

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
}));

vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => ({ data: [] }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    task: {
      sourceIssues: (ids: readonly string[]) => {
        const out = new Map<string, string>();
        for (const id of ids) { const v = issues.map.get(id); if (v) out.set(id, v); }
        return Promise.resolve(out);
      },
    },
  },
}));

import TasksTab from '../tabs/TasksTab';

/** Shows the live URL so a test can assert the link opens the issue, never the drawer (no `?open=`). */
function UrlProbe() {
  const location = useLocation();
  return <div data-testid="url-probe">{location.pathname}{location.search}{location.hash}</div>;
}

const seed = [
  {
    id: 'task-aaa',
    project_id: 'p1',
    name: 'Replace the guard rail',
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
    name: 'Plain work',
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

const renderTab = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/tasks']}>
        <UrlProbe />
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
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  milestoneState.data = [];
  issues.map = new Map([['task-aaa', 'issue-9']]);
});

describe('JOB-F17 the Tasks tab links a task back to the issue it was made from', () => {
  it('renders the issue link inside the #task-<id> anchor of the task that has one', async () => {
    renderTab();
    const link = await screen.findByRole('link', { name: 'From issue' });
    expect(link).toHaveAttribute('href', '/incidents/issue-9');
    const anchor = document.getElementById('task-task-aaa');
    expect(anchor).not.toBeNull();
    expect(within(anchor as HTMLElement).getByRole('link', { name: 'From issue' })).toBe(link);
  });

  it('a task that was not made from an issue carries no issue link', async () => {
    renderTab();
    await screen.findByRole('link', { name: 'From issue' });
    const anchor = document.getElementById('task-task-bbb');
    expect(anchor).not.toBeNull();
    expect(within(anchor as HTMLElement).queryByRole('link', { name: 'From issue' })).toBeNull();
  });

  it('opening the issue navigates to it and does not open the task drawer', async () => {
    const user = userEvent.setup();
    renderTab();
    const link = await screen.findByRole('link', { name: 'From issue' });
    await user.click(link);
    const url = screen.getByTestId('url-probe').textContent ?? '';
    expect(url).toContain('/incidents/issue-9');
    expect(url).not.toContain('open=');
  });
});
