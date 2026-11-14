import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { openHiddenReasons } from '@/test/homeLayout';
import { PMDashboard } from './PMDashboard';

const state = vi.hoisted(() => ({
  projects: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  delivery: { data: {} as Record<string, number>, isPending: false, isError: false, refetch: vi.fn() },
  timesheets: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  procurements: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  projectTasks: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  orgDay: { day: '2026-11-08' as string | null, isPending: false, isError: false, retry: vi.fn() },
  myTasks: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  needs: {
    items: [] as unknown[],
    pmOverdueTasksByProject: {} as Record<string, number>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  usePMDashboardProjects: () => state.projects,
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => state.delivery,
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => state.timesheets,
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => state.procurements,
}));
vi.mock('@/src/hooks/usePMOverdueTasks', () => ({
  usePMOverdueTasks: () => state.projectTasks,
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => state.myTasks }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-08' }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => state.orgDay }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => state.needs,
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectNumbers: (ids: string[]) => ({ data: Object.fromEntries(ids.map((id) => [id, null])) }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const makeProject = (overrides: Partial<PMDashboardProject> & Pick<PMDashboardProject, 'id' | 'name' | 'status'>): PMDashboardProject => {
  const { id, name, status, ...rest } = overrides;
  return {
    id, name, status, short_name: null, client_name: 'Acme Works', contract_value: 100_000, currency: 'USD',
    budget: 100_000, spent: 95_000, actual_currency: 'USD', actual_complete: true, budget_currency: 'USD',
    actual_coverage_count: 1, actual_coverage_total: 1, realized_margin: 12_500, realized_margin_pct: 0.125,
    contract_remaining: 5_000, ...rest,
  };
};

const approvalItems = [
  { id: 'approvals', count: 3, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' },
  { id: 'team-timesheets', count: 2, label: 'team timesheets to approve', href: '/approvals?scope=timesheets', tone: 'warn' },
];

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
};

const overviewLayout = () => localStorage.setItem('home-layout', 'overview');

const renderDashboard = () => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><LocationProbe /><PMDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  cleanup();
  localStorage.setItem('home-layout', 'focused');
  state.projects.data = [
    makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project' }),
    makeProject({ id: 'p2', name: 'Project Two', status: 'On Hold' }),
  ];
  state.projects.isPending = false;
  state.projects.isError = false;
  state.delivery.data = { p1: 45 };
  state.delivery.isPending = false;
  state.delivery.isError = false;
  state.timesheets.data = [{ id: 'ts1', entries: [{ hours: 2.5 }, { hours: 3.25 }] }];
  state.timesheets.isPending = false;
  state.timesheets.isError = false;
  state.procurements.data = [];
  state.procurements.isPending = false;
  state.procurements.isError = false;
  state.projectTasks.data = [];
  state.projectTasks.isPending = false;
  state.projectTasks.isError = false;
  state.orgDay = { day: '2026-11-08', isPending: false, isError: false, retry: vi.fn() };
  state.myTasks.data = [];
  state.myTasks.isPending = false;
  state.myTasks.isError = false;
  state.myTasks.refetch.mockReset();
  state.projects.refetch.mockReset();
  state.procurements.refetch.mockReset();
  state.timesheets.refetch.mockReset();
  state.needs.items = approvalItems;
  state.needs.pmOverdueTasksByProject = {};
  state.needs.isPending = false;
  state.needs.isError = false;
  state.needs.refetch.mockReset();
});

describe('PM home — floor (floor-tests/home-pm.md)', () => {
  it('floor: a hidden contract figure says why', async () => {
    state.projects.data = [makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project', contract_value: null })];
    renderDashboard();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('1 figure hidden');
    await openHiddenReasons();
    expect(await screen.findByText('a project contract value is missing')).toBeInTheDocument();
  });

  it('floor: the approvals waits row opens /approvals', async () => {
    const user = userEvent.setup();
    renderDashboard();
    const waits = within(screen.getByTestId('waits-on-you'));
    await user.click(waits.getByRole('link', { name: /approvals waiting for you/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/approvals$/);
  });

  it('floor: the team-timesheets waits row opens the timesheet approvals queue', async () => {
    const user = userEvent.setup();
    renderDashboard();
    const waits = within(screen.getByTestId('waits-on-you'));
    await user.click(waits.getByRole('link', { name: /team timesheets to approve/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/approvals?scope=timesheets');
  });

  it('floor: an overdue own-task row opens My Tasks', async () => {
    state.myTasks.data = [{ id: 'late', status: 'In Progress', end_date: '2026-11-07' }];
    const user = userEvent.setup();
    renderDashboard();
    const waits = within(screen.getByTestId('waits-on-you'));
    await user.click(waits.getByRole('link', { name: /task overdue/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/my-tasks$/);
  });

  it('floor: the waits card Retry reruns the waits reads', async () => {
    state.needs.isError = true;
    renderDashboard();
    const waits = within(screen.getByTestId('waits-on-you'));
    const alert = waits.getByText("Couldn't load what waits on you").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(state.projects.refetch).toHaveBeenCalledOnce();
    expect(state.myTasks.refetch).toHaveBeenCalledOnce();
  });

  it('floor: All N projects opens the PM-scoped delivery list', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByRole('link', { name: 'All 2 projects' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/projects\?filter=delivery&pm=pm-1$/);
  });

  it('floor: a project row opens that project record', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByRole('link', { name: /Project One/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/projects\/p1$/);
  });

  it('floor: the My contract value tile opens my delivery projects', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(within(screen.getByTestId('kpi-my-contract-value')).getByRole('link'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/projects\?filter=delivery&pm=pm-1$/);
  });

  it('floor: the Team hours to approve tile opens the timesheet approvals queue', async () => {
    overviewLayout();
    const user = userEvent.setup();
    renderDashboard();
    await user.click(within(screen.getByTestId('kpi-team-hours')).getByRole('link'));
    expect(screen.getByTestId('location')).toHaveTextContent('/approvals?scope=timesheets');
  });

  it('floor: the Tasks overdue tile opens the matching projects view', async () => {
    overviewLayout();
    state.needs.items = [...approvalItems, { id: 'overdue-project-tasks', count: 4, label: 'tasks overdue', href: '/projects?filter=delivery&pm=pm-1&tasks=overdue', tone: 'lost' }];
    const user = userEvent.setup();
    renderDashboard();
    await user.click(within(screen.getByTestId('kpi-tasks-overdue')).getByRole('link'));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?filter=delivery&pm=pm-1&tasks=overdue');
  });

  it('floor: Open my projects on the plan chart opens the PM projects list', async () => {
    overviewLayout();
    const user = userEvent.setup();
    renderDashboard();
    const plan = screen.getByRole('heading', { name: 'Plan vs actual' }).closest('.panel-card') as HTMLElement;
    await user.click(within(plan).getByRole('link', { name: 'Open my projects' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/projects\?filter=delivery&pm=pm-1$/);
  });

  it('floor: Open my projects on the delivery chart opens the PM projects list', async () => {
    overviewLayout();
    const user = userEvent.setup();
    renderDashboard();
    const chart = screen.getByTestId('chart-delivery-budget').closest('.panel-card') as HTMLElement;
    await user.click(within(chart).getByRole('link', { name: 'Open my projects' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/projects\?filter=delivery&pm=pm-1$/);
  });

  it('floor: the plan chart Retry refetches the projects read', async () => {
    overviewLayout();
    state.projects.isError = true;
    renderDashboard();
    const plan = screen.getByRole('heading', { name: 'Plan vs actual' }).closest('.panel-card') as HTMLElement;
    const alert = within(plan).getByText("Couldn't load projects").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(state.projects.refetch).toHaveBeenCalledOnce();
  });

  it('floor: the delivery-budget chart Retry reruns the dashboard reads', async () => {
    overviewLayout();
    state.projects.isError = true;
    renderDashboard();
    const chart = screen.getByTestId('chart-delivery-budget');
    const alert = within(chart).getByText("Couldn't load projects").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(state.timesheets.refetch).toHaveBeenCalledOnce();
    expect(state.procurements.refetch).toHaveBeenCalledOnce();
  });
});
