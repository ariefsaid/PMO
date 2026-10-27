import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import { BahasaProvider } from '@/test/bahasa';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { PMDashboard } from './PMDashboard';

const state = vi.hoisted(() => ({
  projects: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  delivery: { data: {} as Record<string, number>, isPending: false, isError: false, refetch: vi.fn() },
  timesheets: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  procurements: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  needs: {
    items: [] as unknown[],
    pmOverdueTasksByProject: {} as Record<string, number>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectDetails: {} as Record<string, unknown>,
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
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => state.needs,
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: (id: string) => state.projectDetails[id] ?? { data: null, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({
  useProjectStatusLabel: () => (status: string) => status,
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
    id,
    name,
    status,
    short_name: null,
    client_name: 'Acme Works',
    contract_value: 100_000,
    currency: 'USD',
    budget: 100_000,
    spent: 95_000,
    actual_currency: 'USD',
    actual_complete: true,
    budget_currency: 'USD',
    actual_coverage_count: 1,
    actual_coverage_total: 1,
    realized_margin: 12_500,
    realized_margin_pct: 0.125,
    contract_remaining: 5_000,
    ...rest,
  };
};

const projects = [
  makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project' }),
  makeProject({
    id: 'p2', name: 'Project Two', status: 'On Hold', contract_value: 250_000,
    budget: 200_000, spent: 50_000, contract_remaining: 200_000, realized_margin: 40_000,
    realized_margin_pct: 0.2,
  }),
  makeProject({
    id: 'p3', name: 'Project Three', status: 'Close Out', contract_value: 150_000,
    budget: 100_000, spent: 10_000, contract_remaining: 140_000, realized_margin: 30_000,
    realized_margin_pct: 0.15,
  }),
  makeProject({ id: 'lost', name: 'Lost Project', status: 'Loss Tender' }),
  makeProject({ id: 'lead', name: 'Pipeline Project', status: 'Leads' }),
];

const approvalItems = [
  { id: 'approvals', count: 3, label: '3 approvals waiting for you', href: '/approvals', tone: 'warn' },
  { id: 'team-timesheets', count: 2, label: '2 team timesheets to approve', href: '/approvals?scope=timesheets', tone: 'warn' },
];

let queryClient: QueryClient;
const renderDashboard = (locale: 'en' | 'id' = 'en') => {
  setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BahasaProvider locale={locale}>
        <MemoryRouter><PMDashboard /></MemoryRouter>
      </BahasaProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  cleanup();
  state.projects.data = projects;
  state.projects.isPending = false;
  state.projects.isError = false;
  state.delivery.data = { p1: 45, p2: 70, p3: 20 };
  state.delivery.isPending = false;
  state.delivery.isError = false;
  state.timesheets.data = [{ id: 'ts1', entries: [{ hours: 2.5 }, { hours: 3.25 }] }];
  state.timesheets.isPending = false;
  state.timesheets.isError = false;
  state.procurements.data = [];
  state.procurements.isPending = false;
  state.procurements.isError = false;
  state.needs.items = approvalItems;
  state.needs.pmOverdueTasksByProject = { p1: 2 };
  state.needs.isPending = false;
  state.needs.isError = false;
  state.projectDetails = Object.fromEntries(projects.map((project, index) => [project.id, {
    data: { pmo_project_number: `PRJ-26-${String(index + 1).padStart(4, '0')}` },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }]));
  for (const query of [state.projects, state.delivery, state.timesheets, state.procurements, state.needs]) {
    query.refetch.mockReset();
  }
});

describe('Project Manager area hub', () => {
  it('shows five linked KPIs, approvals, and project figures with working destinations', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { level: 1, name: 'My dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Your 3 projects and what needs you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();

    const expectedKpis = [
      ['kpi-my-projects', 'My projects', '/projects?filter=My+Projects'],
      ['kpi-my-contract-value', 'My contract value', '/projects?filter=My+Projects'],
      ['kpi-at-risk', 'At risk', '/projects?filter=at-risk'],
      ['kpi-margin-to-date', 'Margin to date', '/projects?filter=My+Projects'],
      ['kpi-team-hours', 'Team hours to approve', '/approvals?scope=timesheets'],
    ];

    for (const [testId, label, href] of expectedKpis) {
      const tile = screen.getByTestId(testId);
      expect(tile).toHaveTextContent(label);
      expect(within(tile).getByRole('link')).toHaveAttribute('href', href);
      expect(within(tile).getByRole('button', { name: `Help: ${label}` })).toBeInTheDocument();
    }

    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$500K');
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$345K left after spending');
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-margin-to-date')).toHaveTextContent('$82.5K');
    expect(screen.getByTestId('kpi-team-hours')).toHaveTextContent('5.75 h');

    expect(screen.getByRole('link', { name: /3 approvals waiting for you/i })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('link', { name: /2 team timesheets to approve/i })).toHaveAttribute('href', '/approvals?scope=timesheets');
    expect(screen.getByRole('link', { name: 'Project One' })).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByText('PRJ-26-0001')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Works')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Delivery 45%' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Project One: 95% of contract spent' })).toBeInTheDocument();
  });

  it('shows project-specific risk, overdue task, and procurement links without work actions', () => {
    state.procurements.data = [{
      id: 'pr1', project_id: 'p1', requested_by_id: 'another-user', status: 'Requested', approvalRoute: null,
    }];
    renderDashboard();

    const area = screen.getByRole('heading', { name: 'Project One' }).closest('.rounded-lg.border');
    expect(area).not.toBeNull();
    expect(within(area as HTMLElement).getByRole('link', { name: /budget is at least 90% spent/i })).toHaveAttribute('href', '/projects/p1');
    expect(within(area as HTMLElement).getByRole('link', { name: /2 overdue tasks/i })).toHaveAttribute('href', '/projects/p1/tasks');
    expect(within(area as HTMLElement).getByRole('link', { name: /procurement waiting for your approval/i })).toHaveAttribute('href', '/procurement?open=pr1');
    expect(screen.getAllByText('Nothing needs you here.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^(approve|submit|create)/i })).not.toBeInTheDocument();
  });

  it('keeps only delivery projects, orders attention first, caps panels at six, and links to all projects', () => {
    state.projects.data = [
      ...projects.slice(0, 3),
      makeProject({ id: 'p4', name: 'Project Four', status: 'Ongoing Project', spent: 20_000 }),
      makeProject({ id: 'p5', name: 'Project Five', status: 'Ongoing Project', spent: 20_000 }),
      makeProject({ id: 'p6', name: 'Project Six', status: 'Ongoing Project', spent: 20_000 }),
      makeProject({ id: 'p7', name: 'Project Seven', status: 'Ongoing Project', spent: 20_000 }),
      ...projects.slice(3),
    ];
    state.needs.pmOverdueTasksByProject = { p6: 5 };
    renderDashboard();

    const projectHeadings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(projectHeadings.slice(0, 2)).toEqual(['Project One', 'Project Six']);
    expect(projectHeadings).toHaveLength(6);
    expect(screen.queryByRole('heading', { name: 'Project Seven' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lost Project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pipeline Project' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all 7 projects' })).toHaveAttribute('href', '/projects?filter=My+Projects');
  });

  it('keeps currencies separate and shows an explained dash when an aggregate is incomplete', () => {
    state.projects.data = [
      projects[0],
      makeProject({
        id: 'eur', name: 'Euro Project', status: 'Ongoing Project', currency: 'EUR',
        contract_value: 80_000, budget_currency: 'EUR', actual_currency: 'EUR',
      }),
    ];
    renderDashboard();

    const contract = screen.getByTestId('kpi-my-contract-value');
    expect(contract).toHaveTextContent('USD');
    expect(contract).toHaveTextContent('EUR');

    cleanup();
    state.projects.data = [
      projects[0],
      makeProject({ id: 'unknown', name: 'Unknown Project', status: 'Ongoing Project', contract_value: null, realized_margin: null }),
    ];
    renderDashboard();

    const unknownContract = screen.getByTestId('kpi-my-contract-value');
    const unknownMargin = screen.getByTestId('kpi-margin-to-date');
    expect(within(unknownContract).getByText('—')).toBeInTheDocument();
    expect(within(unknownMargin).getByText('—')).toBeInTheDocument();
    const unknownReason = within(unknownContract).getByRole('button', { name: /one or more project contract values are unavailable/i });
    fireEvent.focus(unknownReason);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/one or more project contract values are unavailable/i);
  });

  it('shows loading, retryable error, and the no-project state', () => {
    state.projects.data = undefined;
    state.projects.isPending = true;
    renderDashboard();
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);

    cleanup();
    state.projects.isPending = false;
    state.projects.isError = true;
    renderDashboard();
    expect(screen.getByText("Couldn't load your projects and attention items")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.projects.refetch).toHaveBeenCalledOnce();

    cleanup();
    state.projects.isError = false;
    state.projects.data = [];
    renderDashboard();
    expect(screen.getByText('No delivery projects assigned to you yet')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('0');
    expect(screen.queryByRole('link', { name: /View all/ })).not.toBeInTheDocument();
  });

  it('refreshes the dashboard read queries from the outline control', () => {
    renderDashboard();

    vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(state.projects.refetch).toHaveBeenCalledOnce();
    expect(state.delivery.refetch).toHaveBeenCalledOnce();
    expect(state.timesheets.refetch).toHaveBeenCalledOnce();
    expect(state.procurements.refetch).toHaveBeenCalledOnce();
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('localizes the page title, project empty state, and KPI labels in Indonesian', () => {
    state.projects.data = [];
    renderDashboard('id');

    expect(screen.getByRole('heading', { level: 1, name: 'Dasbor saya' })).toBeInTheDocument();
    expect(screen.getByText('Belum ada proyek pelaksanaan yang ditugaskan kepada Anda')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('Proyek saya');
    expect(screen.getByTestId('kpi-team-hours')).toHaveTextContent('Jam tim yang perlu disetujui');
  });
});
