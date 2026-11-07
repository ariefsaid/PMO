/**
 * #1980 — TasksTab.onReschedule: the timeline drag saves through the task update mutation, only
 * for roles that may edit the task, and a rejected save toasts and snaps the bar back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GanttProps } from '@/src/components/reui/gantt/gantt';
import type { GanttProposedUpdate } from '@/src/components/reui/gantt/gantt-types';

const { listState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
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
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
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
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: realRole }),
}));

let captured: GanttProps<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('@/src/components/reui/gantt/gantt', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/src/components/reui/gantt/gantt')>();
  return {
    ...mod,
    Gantt: (props: GanttProps<any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      captured = props;
      return <mod.Gantt {...props} />;
    },
  };
});

import TasksTab from '../tabs/TasksTab';
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';

const seed = [{
  id: 't1', project_id: 'p1', name: 'Survey the site', status: 'To Do', assignee_id: null,
  start_date: '2026-03-02', end_date: '2026-03-06', org_id: 'org-1', milestone_id: null,
  created_at: '2026-01-01T00:00:00Z', assignee: null, dependencies: [],
}];
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const drag = () => {
  const event = captured!.events!.find((e) => e.id === 't1')!;
  return act(async () => {
    captured!.onEventUpdate!({
      event, occurrence: null, start: day('2026-03-09'), end: day('2026-03-14'), allDay: true, source: 'drag',
    } as GanttProposedUpdate);
  });
};
const barStart = () => captured!.events!.find((e) => e.id === 't1')!.start;

async function openTimeline(role: Role) {
  realRole = role;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/tasks']}>
        <ToastProvider>
          <TasksTab projectId="p1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('tab', { name: /timeline/i }));
  await waitFor(() => expect(screen.getByRole('figure')).toBeInTheDocument());
}

beforeEach(() => {
  clearOwnershipCache();
  setTaskOwnership([]);
  setProjectBindings([]);
  listState.data = seed;
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
  });
});

describe('#1980 TasksTab.onReschedule', () => {
  it('an editing role saves the dates through the update mutation', async () => {
    await openTimeline('Project Manager');
    await drag();
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
      id: 't1',
      patch: { start_date: '2026-03-09', end_date: '2026-03-13' },
    });
  });

  it('a role that may not edit the task makes no write and the bar stays put', async () => {
    await openTimeline('Finance');
    await drag();
    expect(mutations.update.mutateAsync).not.toHaveBeenCalled();
    expect(barStart()).toEqual(day('2026-03-02'));
  });

  it('a rejected save shows the write-error toast and the bar snaps back', async () => {
    mutations.update.mutateAsync.mockRejectedValue(new Error('boom'));
    await openTimeline('Project Manager');
    await drag();
    expect(await screen.findByText('Update failed')).toBeInTheDocument();
    await waitFor(() => expect(barStart()).toEqual(day('2026-03-02')));
  });
});
