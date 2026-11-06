/**
 * Render-work (perf) proof for the Project Manager dashboard's memo boundaries.
 *
 * The page re-renders once per query settle (~10 on load). The KPI band and each project card are
 * now memoised on their own data, so an unrelated settle no longer repaints them. These tests change
 * ONE source between renders and read the panel again: a memo that went stale would keep the old
 * text, so a green test here is the no-stale-UI guarantee for the boundaries.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import { PMDashboard } from './PMDashboard';

const state = vi.hoisted(() => ({
  projects: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  delivery: { data: {} as Record<string, number>, isPending: false, isError: false, refetch: vi.fn() },
  timesheets: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  procurements: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  needs: {
    items: [] as Array<Record<string, unknown>>,
    pmOverdueTasksByProject: {} as Record<string, number>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectNumbers: { data: {} as Record<string, string | null>, isPending: false, isError: false },
}));

vi.mock('@/src/hooks/useDashboard', () => ({ usePMDashboardProjects: () => state.projects }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => state.delivery }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({ useTimesheetsAwaitingApproval: () => state.timesheets }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => state.procurements }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({ useNeedsYou: () => state.needs }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectNumbers: (ids: string[]) => ({
    ...state.projectNumbers,
    data: Object.fromEntries(Object.entries(state.projectNumbers.data).filter(([id]) => ids.includes(id))),
  }),
}));
// The status label stays REAL: a pure i18n lookup that the cards render.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }) }));

const makeProject = (overrides: Partial<PMDashboardProject> & Pick<PMDashboardProject, 'id' | 'name' | 'status'>): PMDashboardProject => {
  const { id, name, status, ...rest } = overrides;
  return {
    id, name, status, short_name: null, client_name: 'Acme Works',
    contract_value: 100_000, currency: 'USD', budget: 100_000, spent: 25_000,
    actual_currency: 'USD', actual_complete: true, budget_currency: 'USD',
    actual_coverage_count: 1, actual_coverage_total: 1, realized_margin: 12_500, realized_margin_pct: 0.125,
    contract_remaining: 75_000, ...rest,
  };
};

const projectOne = () => makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project' });

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = () => <QueryClientProvider client={client}><MemoryRouter><PMDashboard /></MemoryRouter></QueryClientProvider>;

/** The card whose heading links to the project. */
const card = (name: string) => {
  const area = screen.getByRole('heading', { name }).closest('.panel-card');
  expect(area).not.toBeNull();
  return area as HTMLElement;
};

beforeEach(() => {
  cleanup();
  state.projects.data = [projectOne()];
  state.projects.isPending = false;
  state.projects.isError = false;
  state.delivery.data = { p1: 45 };
  state.delivery.isPending = false;
  state.delivery.isError = false;
  state.timesheets.data = [{ id: 'ts1', entries: [{ hours: 2.5 }] }];
  state.timesheets.isPending = false;
  state.timesheets.isError = false;
  state.procurements.data = [];
  state.procurements.isPending = false;
  state.procurements.isError = false;
  state.needs.items = [];
  state.needs.pmOverdueTasksByProject = { p1: 2 };
  state.needs.isPending = false;
  state.needs.isError = false;
  state.projectNumbers = { data: { p1: 'PRJ-26-0001' }, isPending: false, isError: false };
});

describe('PM dashboard memoised panels still show changed data', () => {
  it('KPI band: contract value and project count follow the project rows', () => {
    const view = render(tree());
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$100K');
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('1');

    state.projects.data = [projectOne(), makeProject({ id: 'p2', name: 'Project Two', status: 'Ongoing Project', contract_value: 400_000, spent: 20_000, contract_remaining: 380_000 })];
    view.rerender(tree());
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$500K');
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('2');
  });

  it('project card: the delivery share repaints when the project progress changes', () => {
    const view = render(tree());
    expect(within(card('Project One')).getByRole('img', { name: 'Delivery 45%' })).toBeInTheDocument();

    state.delivery.data = { p1: 80 };
    view.rerender(tree());
    expect(within(card('Project One')).getByRole('img', { name: 'Delivery 80%' })).toBeInTheDocument();
  });

  it('project card: the overdue-task attention line follows its own count', () => {
    const view = render(tree());
    expect(within(card('Project One')).getByRole('link', { name: /2 overdue tasks/i })).toHaveAttribute('href', '/projects/p1/tasks');

    state.needs.pmOverdueTasksByProject = { p1: 5 };
    view.rerender(tree());
    expect(within(card('Project One')).getByRole('link', { name: /5 overdue tasks/i })).toBeInTheDocument();
  });

  it('project card: a procurement waiting for approval appears when the queue gains it', () => {
    const view = render(tree());
    expect(within(card('Project One')).queryByRole('link', { name: /procurement waiting for your approval/i })).not.toBeInTheDocument();

    state.procurements.data = [{ id: 'pr1', project_id: 'p1', requested_by_id: 'another-user', status: 'Requested', approvalRoute: null, title: 'Inverter spares' }];
    view.rerender(tree());
    const area = card('Project One');
    expect(within(area).getByRole('link', { name: /procurement waiting for your approval/i })).toHaveAttribute('href', '/procurement?open=pr1');
    expect(within(area).getByText('Inverter spares')).toBeInTheDocument();
  });
});
