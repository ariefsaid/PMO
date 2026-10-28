import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { EngineerDashboard } from './EngineerDashboard';
import { BahasaProvider } from '@/test/bahasa';

const state = vi.hoisted(() => ({
  timesheets: { data: undefined as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  tasks: { data: undefined as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  expenses: {
    data: undefined as { rows: unknown[]; truncated: boolean } | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  needs: { items: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  orgDay: { day: '2026-06-03' as string | null, isPending: false, isError: false, retry: vi.fn() },
  userId: 'eng-1',
}));

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => state.timesheets }));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => state.tasks }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaims: () => state.expenses }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({ useNeedsYou: () => state.needs }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => state.orgDay }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: state.userId, org_id: 'org-1' } }) }));

const entry = (id: string, entry_date: string, hours: number, notes: string | null) => ({
  id,
  hours,
  entry_date,
  project_id: 'p1',
  timesheet_id: 'current',
  org_id: 'org-1',
  notes,
  project: { name: 'Cedar Works', code: 'PRJ-1' },
});

const sheets = [
  {
    id: 'future', status: 'Draft', week_start_date: '2026-06-08', user_id: 'eng-1', org_id: 'org-1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [entry('future-entry', '2026-06-08', 99, 'Future week')],
  },
  {
    id: 'current', status: 'Rejected', week_start_date: '2026-06-01', user_id: 'eng-1', org_id: 'org-1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [entry('e1', '2026-06-01', 8, 'Design review'), entry('e2', '2026-06-02', 7.5, 'Site handover')],
  },
  {
    id: 'previous', status: 'Approved', week_start_date: '2026-05-25', user_id: 'eng-1', org_id: 'org-1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [entry('e0', '2026-05-25', 40, 'Earlier work')],
  },
];

const tasks = [
  { id: 'overdue', name: 'Finalize drawings', status: 'In Progress', assignee_id: 'eng-1', project_id: 'p1', project_name: 'Cedar Works', start_date: null, end_date: '2026-05-31' },
  { id: 'due', name: 'Prepare handover', status: 'To Do', assignee_id: 'eng-1', project_id: 'p1', project_name: 'Cedar Works', start_date: null, end_date: '2026-06-04' },
  { id: 'done', name: 'Close punch list', status: 'Done', assignee_id: 'eng-1', project_id: 'p1', project_name: 'Cedar Works', start_date: null, end_date: '2026-06-03' },
  { id: 'later', name: 'Plan next phase', status: 'To Do', assignee_id: 'eng-1', project_id: 'p1', project_name: 'Cedar Works', start_date: null, end_date: '2026-06-12' },
  { id: 'undated', name: 'Review notes', status: 'To Do', assignee_id: 'eng-1', project_id: 'p1', project_name: 'Cedar Works', start_date: null, end_date: null },
];

const claims = [
  { id: 'returned', kind: 'claim', claimant_id: 'eng-1', status: 'Rejected', title: 'Travel receipt', project: { name: 'Cedar Works' }, updated_at: '2026-06-02' },
  { id: 'draft', kind: 'claim', claimant_id: 'eng-1', status: 'Draft', title: 'Open draft', project: null, updated_at: '2026-06-02' },
  { id: 'other', kind: 'claim', claimant_id: 'another-user', status: 'Rejected', title: 'Another person’s claim', project: null, updated_at: '2026-06-02' },
  { id: 'advance', kind: 'advance', claimant_id: 'eng-1', status: 'Rejected', title: 'Cash advance', project: null, updated_at: '2026-06-02' },
];

const attentionItems = [
  { id: 'timesheet-returned', count: 1, label: "This week's timesheet was returned", href: '/timesheets', tone: 'lost' },
  { id: 'engineer-tasks', count: 2, label: 'tasks overdue or due this week', href: '/my-tasks', tone: 'warn' },
  { id: 'returned-expenses', count: 1, label: 'expense claim returned', href: '/expenses', tone: 'lost' },
];

const LocationProbe = () => {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}</output>;
};

const renderDashboard = (locale: 'en' | 'id' = 'en') => render(
  <BahasaProvider locale={locale}>
    <MemoryRouter initialEntries={['/']}>
      <EngineerDashboard />
      <LocationProbe />
    </MemoryRouter>
  </BahasaProvider>,
);

beforeEach(() => {
  state.timesheets.data = sheets;
  state.timesheets.isPending = false;
  state.timesheets.isError = false;
  state.timesheets.refetch = vi.fn();
  state.tasks.data = tasks;
  state.tasks.isPending = false;
  state.tasks.isError = false;
  state.tasks.refetch = vi.fn();
  state.expenses.data = { rows: claims, truncated: false };
  state.expenses.isPending = false;
  state.expenses.isError = false;
  state.expenses.refetch = vi.fn();
  state.needs = { items: attentionItems, isPending: false, isError: false, refetch: vi.fn() };
  state.orgDay = { day: '2026-06-03', isPending: false, isError: false, retry: vi.fn() };
  state.userId = 'eng-1';
});

afterEach(cleanup);

describe('Engineer area hub', () => {
  it('shows four linked KPIs, refresh, and no company money data', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { name: 'My dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Your week and what needs you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('15.5');
    expect(screen.getByTestId('kpi-timesheet-status')).toHaveTextContent('Returned');
    expect(screen.getByTestId('kpi-tasks-due')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-expenses-returned')).toHaveTextContent('1');
    expect(screen.getAllByRole('button', { name: /^Help:/ })).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Open timesheets for this week' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByRole('link', { name: 'Open timesheet status' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByRole('link', { name: 'Open tasks due this week' })).toHaveAttribute('href', '/my-tasks');
    expect(screen.getByRole('link', { name: 'Open returned expense claims' })).toHaveAttribute('href', '/expenses');

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/(?:Rp|USD|IDR|\$|invoice|budget|revenue|spending)/i);
  });

  it('uses the current week for hours, attention panels, and a week-only basis when expected hours are unknown', () => {
    renderDashboard();

    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('15.5');
    expect(screen.getByTestId('kpi-hours-week')).not.toHaveTextContent('99');
    expect(screen.getByText('Hours by day this week')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Mon: 8 h' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tue: 7.5 h' })).toBeInTheDocument();
    expect(screen.getByText('This week by project')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Cedar Works: 15.5 h/ })).toBeInTheDocument();
    expect(screen.getByText(/Due Fri/)).toBeInTheDocument();
    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('Week of');
    expect(screen.getByTestId('kpi-hours-week')).not.toHaveTextContent(/expected hours/i);

    fireEvent.focus(screen.getByRole('button', { name: 'Help: Hours this week' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Expected weekly hours are not provided by the timesheet data.');
    fireEvent.blur(screen.getByRole('button', { name: 'Help: Hours this week' }));
    fireEvent.focus(screen.getByRole('button', { name: 'Help: Timesheet status' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Status comes from this week’s timesheet. If none exists yet, it is marked Not started. Timesheets are due Friday.');
  });

  it('lists overdue and this-week tasks, and only the signed-in engineer’s rejected claims', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { name: 'Overdue' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Finalize drawings/ })).toHaveAttribute('href', '/my-tasks');
    expect(screen.getByRole('heading', { name: 'Due this week' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Prepare handover/ })).toHaveAttribute('href', '/my-tasks');
    expect(screen.queryByText('Close punch list')).not.toBeInTheDocument();
    expect(screen.queryByText('Plan next phase')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Travel receipt/ })).toHaveAttribute('href', '/expenses');
    expect(screen.queryByText('Open draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Another person’s claim')).not.toBeInTheDocument();
    expect(screen.queryByText('Cash advance')).not.toBeInTheDocument();
  });

  it('opens a recent entry in Timesheets and includes its description and status', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { name: 'Recent entries' })).toBeInTheDocument();
    expect(screen.getByText('Design review')).toBeInTheDocument();
    expect(screen.queryByText('Future week')).not.toBeInTheDocument();
    expect(screen.getAllByText('Cedar Works').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8 h').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Returned').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Open timesheet entry for Cedar Works: Site handover/ }));
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/timesheets');
  });

  it('refreshes the owned sources and keeps the loading and error states retryable', () => {
    const refresh = renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.timesheets.refetch).toHaveBeenCalledOnce();
    expect(state.tasks.refetch).toHaveBeenCalledOnce();
    expect(state.expenses.refetch).toHaveBeenCalledOnce();
    expect(state.orgDay.retry).toHaveBeenCalledOnce();
    expect(state.needs.refetch).toHaveBeenCalledOnce();
    refresh.unmount();

    state.timesheets.data = undefined;
    state.timesheets.isPending = true;
    state.tasks.data = undefined;
    state.tasks.isPending = true;
    state.expenses.data = undefined;
    state.expenses.isPending = true;
    const loading = renderDashboard();
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    expect(screen.queryByText('0 overdue · 0 due this week')).not.toBeInTheDocument();
    loading.unmount();

    state.timesheets.isPending = false;
    state.timesheets.isError = true;
    state.tasks.isPending = false;
    state.tasks.isError = true;
    state.expenses.isPending = false;
    state.expenses.isError = true;
    state.orgDay.isPending = false;
    state.orgDay.isError = true;
    renderDashboard();
    expect(screen.getAllByRole('button', { name: /Retry|Try again/ }).length).toBeGreaterThan(0);
  });

  it('shows a genuine zero and a Timesheets link when no hours are logged this week', () => {
    state.timesheets.data = [{ ...sheets[1], entries: [] }];
    state.tasks.data = [];
    state.expenses.data = { rows: [], truncated: false };
    state.needs.items = [];
    renderDashboard();

    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('0');
    expect(screen.getAllByText('No hours logged this week').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Log hours in Timesheets' }).every((link) => link.getAttribute('href') === '/timesheets')).toBe(true);
  });

  it('keeps Recent entries table content inside the area panel without a second frame', () => {
    renderDashboard();
    const heading = screen.getByRole('heading', { name: 'Recent entries' });
    const panel = heading.closest('.rounded-lg.border');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.rounded-b-lg.border')).toBeNull();
  });

  it('shows Not started and Friday due date when this week has no timesheet', () => {
    state.timesheets.data = sheets.filter((sheet) => sheet.week_start_date !== '2026-06-01');
    renderDashboard();

    const timesheet = screen.getByTestId('kpi-timesheet-status');
    expect(timesheet).toHaveTextContent('Not started');
    expect(timesheet).toHaveTextContent('Due Fri');
    expect(timesheet).not.toHaveTextContent('—');
    expect(screen.getByRole('link', { name: 'Open timesheet status' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByRole('link', { name: /2 tasks overdue or due this week/i })).toHaveAttribute('href', '/my-tasks');
  });

  it('shows unknown values when a source has no loaded data', () => {
    state.timesheets.data = undefined;
    state.timesheets.isPending = false;
    state.tasks.data = undefined;
    state.tasks.isPending = false;
    state.expenses.data = undefined;
    state.expenses.isPending = false;
    renderDashboard();

    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-timesheet-status')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-tasks-due')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-expenses-returned')).toHaveTextContent('—');
    expect(screen.queryByRole('heading', { name: 'Overdue' })).not.toBeInTheDocument();
  });

  it('localizes Engineer labels and empty copy in Indonesian', () => {
    state.timesheets.data = [{ ...sheets[1], entries: [] }];
    renderDashboard('id');

    expect(screen.getByRole('heading', { name: 'Dasbor saya' })).toBeInTheDocument();
    expect(screen.getByText('Minggu Anda dan hal yang perlu diperhatikan')).toBeInTheDocument();
    expect(screen.getAllByText('Tidak ada jam yang dicatat minggu ini').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Ported from the pre-restructure EngineerDashboard.test.tsx (baseline fa511c382): Bahasa, per-project
// bars, the recent-entries cap, the single Log-hours CTA, a11y-labelled breakdowns and neutral data bars.
// ---------------------------------------------------------------------------

describe('Engineer area hub — ported baseline cases', () => {
  it('AC-UXA-002: localizes the week, status, day summaries and actions while retaining data', () => {
    renderDashboard('id');
    expect(screen.getByRole('heading', { name: 'Dasbor saya' })).toBeInTheDocument();
    const hours = screen.getByTestId('kpi-hours-week');
    expect(hours).toHaveTextContent('Jam minggu ini');
    expect(hours).toHaveTextContent('15.5');
    fireEvent.focus(screen.getByRole('button', { name: 'Bantuan: Jam minggu ini' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Jam kerja adalah jumlah entri timesheet Anda untuk minggu ini.');
    expect(screen.getByRole('link', { name: 'Buka Timesheets minggu ini' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByTestId('kpi-timesheet-status')).toHaveTextContent('Dikembalikan');
    expect(screen.getByRole('group', { name: 'Jam kerja per hari minggu ini' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Minggu ini berdasarkan proyek' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entri terbaru' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Sen: 8 jam' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Cedar Works: 15.5 jam/ })).toBeInTheDocument();
    // Data is translated for display only.
    expect(sheets[1].entries[0].hours).toBe(8);
    expect(sheets[1].status).toBe('Rejected');

    cleanup();
    const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'];
    state.timesheets.data = [{ ...sheets[1], entries: days.map((entryDate, index) => entry(`day-${index}`, entryDate, index + 1, null)) }];
    renderDashboard('id');
    for (const [name, value] of [['Sen', 1], ['Sel', 2], ['Rab', 3], ['Kam', 4], ['Jum', 5], ['Sab', 6], ['Min', 7]] as const) {
      expect(screen.getByRole('progressbar', { name: `${name}: ${value} jam` })).toBeInTheDocument();
    }

    for (const [status, label] of [['Draft', 'Draf'], ['Submitted', 'Dikirim'], ['Approved', 'Disetujui']] as const) {
      cleanup();
      state.timesheets.data = [{ ...sheets[1], status }];
      renderDashboard('id');
      expect(screen.getByTestId('kpi-timesheet-status')).toHaveTextContent(label);
    }

    cleanup();
    state.timesheets.data = undefined;
    state.timesheets.isPending = true;
    renderDashboard('id');
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('Memuat…').length).toBeGreaterThanOrEqual(1);

    cleanup();
    state.timesheets.isPending = false;
    state.timesheets.isError = true;
    renderDashboard('id');
    expect(screen.getAllByText('Tidak dapat memuat timesheet Anda').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Coba lagi' }).length).toBeGreaterThan(0);

    cleanup();
    state.timesheets.isError = false;
    state.timesheets.data = [];
    renderDashboard('id');
    expect(screen.getByTestId('kpi-timesheet-status')).toHaveTextContent('Belum dimulai');
    expect(screen.getByTestId('kpi-timesheet-status')).not.toHaveTextContent('—');
    expect(screen.getAllByText('Tidak ada jam yang dicatat minggu ini').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Catat jam di Timesheets' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByText('Belum ada entri waktu terbaru')).toBeInTheDocument();
  });

  it('T7: renders a "This week by project" group with one hours bar per distinct project, named', () => {
    state.timesheets.data = [{
      ...sheets[1],
      entries: [
        ...sheets[1].entries,
        { ...entry('e3', '2026-06-03', 2, 'Survey'), project_id: 'p2', project: { name: 'Birch Plant', code: 'PRJ-2' } },
      ],
    }];
    renderDashboard();
    const group = screen.getByRole('group', { name: 'This week by project' });
    expect(within(group).getAllByRole('progressbar')).toHaveLength(2);
    expect(within(group).getByRole('progressbar', { name: /Cedar Works: 15.5 h/ })).toBeInTheDocument();
    expect(within(group).getByRole('progressbar', { name: /Birch Plant: 2 h/ })).toBeInTheDocument();
  });

  it('T9: shows up to 8 recent entries under the "Recent entries" heading', () => {
    const many = Array.from({ length: 10 }, (_, index) => entry(`old-${index}`, `2026-05-${String(20 + index).padStart(2, '0')}`, 1, `Task ${index}`));
    state.timesheets.data = [{ ...sheets[2], entries: many }];
    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Recent entries' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Open timesheet entry for/ })).toHaveLength(8);
  });

  it('T10: with no entries the page offers one Log-hours action — the empty Recent entries adds no competing CTA', () => {
    state.timesheets.data = [];
    state.needs.items = [];
    renderDashboard();
    expect(screen.getByText('No recent time entries')).toBeInTheDocument();
    const logHours = [
      ...screen.queryAllByRole('link', { name: /log hours/i }),
      ...screen.queryAllByRole('button', { name: /log hours/i }),
    ];
    expect(logHours).toHaveLength(1);
    expect(logHours[0]).toHaveAttribute('href', '/timesheets');
  });

  it('renders the weekly-hours breakdown labelled for a11y, and no tasks coming-soon placeholder', () => {
    renderDashboard();
    expect(screen.getByRole('group', { name: 'Hours by day this week' })).toBeInTheDocument();
    expect(screen.queryByText(/Task tracking is coming soon/i)).not.toBeInTheDocument();
  });

  it('M-1: hours bars stay neutral data bars, not blue action bars', () => {
    renderDashboard();
    const dayFill = screen.getByRole('progressbar', { name: 'Mon: 8 h' }).querySelector('span') as HTMLElement;
    expect(dayFill.className).toContain('bg-muted-foreground');
    expect(dayFill.className).not.toContain('bg-primary');
    const projectFill = screen.getByRole('progressbar', { name: /Cedar Works: 15.5 h/ }).querySelector('span') as HTMLElement;
    expect(projectFill.className).toContain('bg-muted-foreground');
    expect(projectFill.className).not.toContain('bg-primary');
  });
});
