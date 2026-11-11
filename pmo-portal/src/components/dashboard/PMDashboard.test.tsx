import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import { BahasaProvider } from '@/test/bahasa';
import { openHiddenReasons } from '@/test/homeLayout';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { PMDashboard } from './PMDashboard';

const state = vi.hoisted(() => ({
  projects: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  delivery: { data: {} as Record<string, number>, isPending: false, isError: false, refetch: vi.fn() },
  timesheets: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  procurements: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  myTasks: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  needs: {
    items: [] as unknown[],
    pmOverdueTasksByProject: {} as Record<string, number>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectDetails: {} as Record<string, unknown>,
  /** The batched project-number read the project areas share (#1890). */
  projectNumbers: { data: {} as Record<string, string | null>, isPending: false, isError: false },
  /** Per-project finances the project Overview reads (its margin gate); a project absent here has none loaded. */
  finances: {} as Record<string, unknown>,
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
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => state.myTasks }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-08' }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => state.needs,
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: (id: string) => state.projectDetails[id] ?? { data: null, isPending: false, isError: false, refetch: vi.fn() },
  // #1890: the project area reads numbers for the visible card set in ONE request. The mock
  // narrows to the ids asked for, so a wrong request set would leave a card without its number.
  useProjectNumbers: (ids: string[]) => ({
    ...state.projectNumbers,
    data: Object.fromEntries(
      Object.entries(state.projectNumbers.data).filter(([id]) => ids.includes(id)),
    ),
  }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: (id: string) => ({ data: state.finances[id], isPending: false, isError: false }),
}));
// useProjectStatusLabel stays REAL (a pure i18n lookup): English defaults equal the enum, and the
// Bahasa port below asserts the translated status a PM actually reads.
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

/**
 * The finances payload the project Overview derives its margin from. A project whose margin is known
 * has every category mapped (margin = billed revenue less spending); otherwise a category is unmapped.
 */
const financesFor = (project: PMDashboardProject, over: { mapped?: boolean } = {}) => ({
  project_id: project.id, contract_invoiced: null, remaining_to_invoice: null, budget: null,
  invoices: [{
    currency: project.currency, invoice_count: 1, invoiced: null, settled: null, outstanding: null, missing_amount: 0,
    missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: `${(project.realized_margin ?? 0) + (project.spent ?? 0)}.00`, missing_work: 0,
  }],
  actuals: {
    currency: project.currency, as_of: null, total: `${project.spent ?? 0}.00`, excludes_restricted_rows: false,
    categories: [{ category: 'Materials', mapped: over.mapped ?? project.realized_margin != null, amount: `${project.spent ?? 0}.00` }],
  },
});
const loadFinances = (list: PMDashboardProject[]) => Object.fromEntries(list.map((project) => [project.id, financesFor(project)]));

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
  { id: 'approvals', count: 3, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' },
  { id: 'team-timesheets', count: 2, label: 'team timesheets to approve', href: '/approvals?scope=timesheets', tone: 'warn' },
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
  state.myTasks.data = [];
  state.myTasks.isPending = false;
  state.myTasks.isError = false;
  state.myTasks.refetch.mockReset();
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
  state.projectNumbers = {
    data: Object.fromEntries(projects.map((project, index) => [project.id, `PRJ-26-${String(index + 1).padStart(4, '0')}`])),
    isPending: false,
    isError: false,
  };
  state.finances = loadFinances(projects);
  for (const query of [state.projects, state.delivery, state.timesheets, state.procurements, state.needs]) {
    query.refetch.mockReset();
  }
});

const waitsRegion = () => screen.getByTestId('waits-on-you');
const projectsRegion = () => screen.getByTestId('pm-projects');
const rowFor = (name: string) => within(projectsRegion()).getByRole('link', { name: new RegExp(name) });

describe('Project Manager home (one question: what needs me, which of my projects is in trouble?)', () => {
  it('adds only my overdue and due-today task counts to Waits on you', () => {
    state.myTasks.data = [
      { id: 'late', status: 'In Progress', end_date: '2026-11-07' },
      { id: 'today-1', status: 'To Do', end_date: '2026-11-08' },
      { id: 'today-2', status: 'Blocked', end_date: '2026-11-08' },
      { id: 'done', status: 'Done', end_date: '2026-11-08' },
      { id: 'later', status: 'To Do', end_date: '2026-11-09' },
    ];
    renderDashboard();

    const overdue = within(waitsRegion()).getByRole('link', { name: /1\s*task overdue/ });
    const dueToday = within(waitsRegion()).getByRole('link', { name: /2\s*tasks due today/ });
    expect(overdue).toHaveAttribute('href', '/my-tasks');
    expect(dueToday).toHaveAttribute('href', '/my-tasks');
    expect(overdue.compareDocumentPosition(dueToday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(waitsRegion()).queryByRole('link', { name: /0 tasks/ })).not.toBeInTheDocument();
  });

  it('leads with what waits on me, then my projects, then my contract value, with working destinations and one help control', () => {
    renderDashboard();
    expect(screen.getByRole('heading', { level: 1, name: 'My dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(1);

    const approvals = within(waitsRegion()).getByRole('link', { name: /approvals waiting for you/ });
    expect(approvals).toHaveAttribute('href', '/approvals');
    const timesheets = within(waitsRegion()).getByRole('link', { name: /team timesheets to approve/ });
    expect(timesheets).toHaveAttribute('href', '/approvals?scope=timesheets');
    expect(timesheets).toHaveTextContent('5.75 h');

    const tile = screen.getByTestId('kpi-my-contract-value');
    expect(tile).toHaveTextContent('My contract value');
    expect(tile).toHaveTextContent('$500K');
    expect(tile).toHaveTextContent('3 projects');
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/projects?filter=delivery&pm=pm-1');

    expect(waitsRegion().compareDocumentPosition(projectsRegion()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(projectsRegion().compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(projectsRegion()).getByRole('link', { name: 'All 3 projects' })).toHaveAttribute('href', '/projects?filter=delivery&pm=pm-1');
  });

  it('AC-AT-RISK-INACTIVE: lists only delivery projects (Close Out included, pre-win and lost excluded), worst first, each routed to its project', () => {
    renderDashboard();
    const links = within(projectsRegion()).getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links.filter((href) => href?.startsWith('/projects/'))).toEqual(['/projects/p1', '/projects/p2', '/projects/p3']);
    expect(within(projectsRegion()).queryByText('Lost Project')).not.toBeInTheDocument();
    expect(within(projectsRegion()).queryByText('Pipeline Project')).not.toBeInTheDocument();
  });

  it('says why a project needs me: overdue tasks, purchases to approve, budget at 90%+; delivery and budget used are numbers; at-risk status is red', () => {
    state.procurements.data = [{ id: 'pr1', project_id: 'p1', status: 'Requested', requested_by_id: 'other' }];
    renderDashboard();
    const one = rowFor('Project One');
    expect(one).toHaveTextContent('2 overdue tasks · 1 purchase to approve · budget at 90% or more');
    expect(one).toHaveTextContent('45%');
    expect(one).toHaveTextContent('95%');
    expect(one).toHaveTextContent('Ongoing');
    const two = rowFor('Project Two');
    expect(two).toHaveTextContent('70%');
    expect(two).toHaveTextContent('25%');
    expect(two).toHaveTextContent('On hold');
    expect(rowFor('Project Three')).toHaveTextContent('Close-out');
  });

  it('UIP-011 / AC-1238-002: a short name is the link text and the contractual name stays its title', () => {
    state.projects.data = [makeProject({ id: 'p1', name: 'Meridian Steelworks', short_name: 'Steelworks', status: 'Ongoing Project' })];
    renderDashboard();
    const link = within(projectsRegion()).getByRole('link', { name: /Steelworks/ });
    expect(link).toHaveAttribute('href', '/projects/p1');
    expect(link).toHaveAttribute('title', 'Meridian Steelworks');
  });

  it('AC-RD-RISK-001: a project whose budget or spend is unknown shows no budget-used figure, never a guess; an unknown delivery shows no figure either', () => {
    state.projects.data = [makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project', budget: null, spent: null, actual_complete: false })];
    state.delivery.data = {};
    state.needs.pmOverdueTasksByProject = {};
    renderDashboard();
    const row = rowFor('Project One');
    expect(row).not.toHaveTextContent('%');
    expect(row).not.toHaveTextContent('—');
  });

  it('AC-RD-MONEY-003: contract value keeps each currency apart, the organisation currency first, never added together', () => {
    state.projects.data = [
      makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project', contract_value: 100_000, currency: 'USD' }),
      makeProject({ id: 'p2', name: 'Project Two', status: 'Ongoing Project', contract_value: 2_000_000_000, currency: 'IDR' }),
    ];
    renderDashboard();
    const tile = screen.getByTestId('kpi-my-contract-value');
    expect(tile).toHaveTextContent('$100K');
    const otherCurrency = within(tile).getByText('IDR 2B');
    expect(otherCurrency).toHaveClass('block');
    expect(otherCurrency).not.toHaveTextContent('+');
    expect(tile).toHaveTextContent(/\$100,000;\s*IDR\s*2,000,000,000/);
    expect(tile.textContent).not.toMatch(/2,100|2\.1B/);
  });

  it('a contract value missing on any project draws no figure and the page names it once', () => {
    state.projects.data = [
      makeProject({ id: 'p1', name: 'Project One', status: 'Ongoing Project' }),
      makeProject({ id: 'p2', name: 'Project Two', status: 'Ongoing Project', contract_value: null }),
    ];
    renderDashboard();
    expect(screen.queryByTestId('kpi-my-contract-value')).not.toBeInTheDocument();
    expect(screen.getAllByText(/1 figure hidden|figures hidden|hidden/i).length).toBeGreaterThan(0);
  });

  it('shows loading, a retryable error, and the no-project state', () => {
    state.projects.isPending = true;
    const loading = renderDashboard();
    expect(within(projectsRegion()).getByTestId('liststate-loading')).toBeInTheDocument();
    loading.unmount();

    state.projects.isPending = false;
    state.projects.isError = true;
    state.projects.data = undefined;
    const failed = renderDashboard();
    fireEvent.click(within(projectsRegion()).getByRole('button', { name: 'Retry' }));
    expect(state.projects.refetch).toHaveBeenCalled();
    failed.unmount();

    state.projects.isError = false;
    state.projects.data = [makeProject({ id: 'lead', name: 'Pipeline Project', status: 'Leads' })];
    renderDashboard();
    expect(within(projectsRegion()).getByText('No delivery projects assigned to you yet')).toBeInTheDocument();
  });

  it('nothing waiting: one plain line, no approvals doorway', () => {
    state.needs.items = [];
    renderDashboard();
    expect(within(waitsRegion()).getByText('Nothing waits on you.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /approvals waiting for you/ })).not.toBeInTheDocument();
  });

  it('Refresh refetches the owned sources', () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.projects.refetch).toHaveBeenCalled();
    expect(state.timesheets.refetch).toHaveBeenCalled();
    expect(state.procurements.refetch).toHaveBeenCalled();
  });

  it('AC-UXA-001: localizes the title, section headings and project statuses without changing values or destinations', () => {
    renderDashboard('id');
    expect(screen.getByRole('heading', { level: 1, name: 'Dasbor saya' })).toBeInTheDocument();
    expect(within(waitsRegion()).getAllByRole('link').map((link) => link.getAttribute('href'))).toContain('/approvals');
    expect(screen.getByRole('heading', { name: 'Proyek saya' })).toBeInTheDocument();
    expect(rowFor('Project Two')).toHaveAttribute('href', '/projects/p2');
    expect(rowFor('Project Two')).toHaveTextContent('70%');
    expect(rowFor('Project Two')).not.toHaveTextContent('On Hold');
  });
});

describe('Project Manager home — layouts', () => {
  const tableRows = (name: string) => (screen.getByRole('img', { name: new RegExp(`^${name}\\.`) }).getAttribute('aria-label') ?? '').slice(name.length + 2).split('; ');
  beforeEach(() => {
    state.needs.items = [...approvalItems, { id: 'overdue-project-tasks', count: 2, label: 'overdue tasks on your projects', href: '/projects?filter=My+Projects', tone: 'lost' }];
  });

  it('Overview (default, also for an unknown stored value): three figures and the two charts', () => {
    localStorage.setItem('home-layout', 'sideways');
    renderDashboard();
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$500K');
    expect(screen.getByTestId('kpi-team-hours')).toHaveTextContent('5.75 h');
    expect(within(screen.getByTestId('kpi-tasks-overdue')).getByRole('link')).toHaveAttribute('href', '/projects?filter=My+Projects');
    const paired = tableRows('Delivery and budget used by project');
    expect(paired[0]).toContain('Project One');
    expect(paired[0]).toContain('45%');
    expect(paired[0]).toContain('95%');
    const overdue = tableRows('Overdue tasks by project');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toContain('Project One');
    expect(overdue[0]).toContain('2');
  });

  it('Overview includes sorted contract, budget, and known spending in the project comparison chart', () => {
    localStorage.removeItem('home-layout');
    renderDashboard();
    const chart = screen.getByRole('img', { name: /plan vs actual by project/i });
    const label = chart.getAttribute('aria-label') ?? '';
    expect(label.indexOf('Project Two')).toBeLessThan(label.indexOf('Project Three'));
    expect(label).toContain('Project Two: Contract $250,000, Budget $200,000, Spent $50,000');
  });

  it('Overview: no overdue tasks reads as a line, not an empty chart', () => {
    localStorage.removeItem('home-layout');
    state.needs.pmOverdueTasksByProject = {};
    state.needs.items = [...approvalItems, { id: 'overdue-project-tasks', count: 0, label: 'overdue tasks on your projects', href: '/projects', tone: 'lost' }];
    renderDashboard();
    expect(screen.getByText('No overdue tasks.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Overdue tasks by project/ })).not.toBeInTheDocument();
  });

  it('Overview: delivery and budget are left out and counted when neither is known', async () => {
    localStorage.removeItem('home-layout');
    state.delivery.data = {};
    state.projects.data = projects.map((project) => ({ ...project, spent: null, actual_complete: false }));
    renderDashboard();
    expect(screen.queryByRole('heading', { name: 'Delivery and budget used by project' })).not.toBeInTheDocument();
    await openHiddenReasons();
    expect(await screen.findByText('delivery and budget are not recorded')).toBeInTheDocument();
  });

  it('Focused: the calm build, one figure and no charts', () => {
    localStorage.setItem('home-layout', 'focused');
    renderDashboard();
    expect(screen.getByTestId('kpi-my-contract-value')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-team-hours')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overdue tasks by project' })).not.toBeInTheDocument();
  });
});
