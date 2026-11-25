import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast as sonnerToast } from 'sonner';
import React from 'react';
import { act } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Repository-seam-backed hooks are mocked; the tab is the unit under test. ──
const { listState, profilesState, milestonesState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  profilesState: { data: [] as unknown[], isPending: false, isError: false },
  milestonesState: { data: [] as unknown[] },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  },
}));

const integrationsState = vi.hoisted(() => ({
  clickupLists: [] as unknown[],
  isListsPending: false,
  isListsError: false,
  listsError: null as unknown,
  refetchLists: vi.fn(),
  linkProject: { mutateAsync: vi.fn().mockResolvedValue({ ok: true }), isPending: false },
  unlinkProject: { mutateAsync: vi.fn().mockResolvedValue({ ok: true }), isPending: false },
  projectBindings: [] as unknown[],
  isBindingsPending: false,
  isBindingsError: false,
  bindingsError: null as unknown,
  refetchBindings: vi.fn(),
  getBinding: vi.fn(),
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => listState,
  useAssignableProfiles: () => profilesState,
  useTaskMutations: () => mutations,
}));
// Milestones stub — empty so the flat list view is used (no grouping) in these tests.
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: milestonesState.data, isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-06-22', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useIntegrations', () => ({
  useIntegrations: () => integrationsState,
}));

// usePermission reads the REAL JWT role from the impersonation context.
let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

// The current user id drives the Engineer own-task gating.
let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));

// #2905: the repaint meter. The wrapper delegates to the real cell, so the row renders exactly as
// production; it only counts how often each row's status cell re-runs while the meter is watching.
const statusCellRenders = vi.hoisted(() => ({ watch: false, count: 0 }));
vi.mock('../tabs/TaskStatusCell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabs/TaskStatusCell')>();
  const Real = actual.TaskStatusCell;
  const CountingTaskStatusCell = (props: React.ComponentProps<typeof Real>) => {
    if (statusCellRenders.watch) statusCellRenders.count += 1;
    return <Real {...props} />;
  };
  return { ...actual, TaskStatusCell: CountingTaskStatusCell };
});

import TasksTab from '../tabs/TasksTab';
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';

afterEach(async () => {
  act(() => { sonnerToast.dismiss(); });
  cleanup();
});

const profiles = [
  { id: 'eng-1', full_name: 'Dana Engineer', role: 'Engineer' },
  { id: 'pm-1', full_name: 'Pat Manager', role: 'Project Manager' },
];

const seed = [
  {
    id: 't1', project_id: 'p1', name: 'Survey the site', status: 'To Do', assignee_id: 'eng-1',
    created_by: 'pm-1', start_date: null, end_date: '2026-06-20', org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z', assignee: { id: 'eng-1', full_name: 'Dana Engineer' }, dependencies: [],
  },
  {
    id: 't2', project_id: 'p1', name: 'Mobilise crew', status: 'In Progress', assignee_id: 'pm-1',
    created_by: 'eng-1', start_date: null, end_date: null, org_id: 'org-1',
    created_at: '2026-02-01T00:00:00Z', assignee: { id: 'pm-1', full_name: 'Pat Manager' }, dependencies: [],
  },
];

const LocationProbe = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  return <output data-testid="location-probe">{`${location.search}|${navigationType}`}</output>;
};

const renderTab = (initialEntry = '/projects/p1/tasks') => {
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <ToastProvider>
          <TasksTab projectId="p1" onCountChange={() => {}} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** Lets transitions and deferred work settle before the count is read as final. */
const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

beforeEach(() => {
  vi.restoreAllMocks();
  clearOwnershipCache();
  setTaskOwnership([]);
  setProjectBindings([]);
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  profilesState.data = profiles;
  profilesState.isPending = false;
  milestonesState.data = [];
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  statusCellRenders.watch = false;
  statusCellRenders.count = 0;
});

describe('#2905 the Tasks tab does not repaint its rows when the task drawer opens or closes', () => {
  it('opening and closing the drawer re-renders no task row', async () => {
    renderTab();
    expect(screen.getByText('Survey the site')).toBeInTheDocument();

    statusCellRenders.watch = true;
    await userEvent.click(screen.getByRole('button', { name: 'Open task Survey the site' }));
    expect(screen.getByRole('dialog', { name: 'Survey the site' })).toBeInTheDocument();
    // The open task still lands in the URL (a PUSH, so Back closes the drawer) exactly as before.
    expect(screen.getByTestId('location-probe')).toHaveTextContent('?open=t1|PUSH');
    await settle();
    const afterOpen = statusCellRenders.count;

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Survey the site' })).not.toBeInTheDocument();
    await settle();
    statusCellRenders.watch = false;

    expect(afterOpen).toBe(0);
    expect(statusCellRenders.count).toBe(0);
  });
});
