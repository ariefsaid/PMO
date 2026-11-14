import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { EngineerDashboard } from './EngineerDashboard';
import { BahasaProvider } from '@/test/bahasa';
import { openHiddenReasons, pinHomeLayout } from '@/test/homeLayout';
import type { TaskStatus } from '@/src/lib/db/tasks';

pinHomeLayout('focused');

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
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => state.orgDay.day ?? '2026-06-03' }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaims: () => state.expenses }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({ useNeedsYou: () => state.needs }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => state.orgDay }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: state.userId, org_id: 'org-1' } }) }));

const entry = (
  id: string,
  entry_date: string,
  hours: number,
  notes: string | null,
  timesheetId = 'current',
) => ({
  id,
  hours,
  entry_date,
  project_id: 'p1',
  timesheet_id: timesheetId,
  org_id: 'org-1',
  notes,
  project: { name: 'Cedar Works', code: 'PRJ-1' },
});

const sheets = [
  {
    id: 'future', status: 'Draft', week_start_date: '2026-06-08', user_id: 'eng-1', org_id: 'org-1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [entry('future-entry', '2026-06-08', 99, 'Future week', 'future')],
  },
  {
    id: 'current', status: 'Rejected', week_start_date: '2026-06-01', user_id: 'eng-1', org_id: 'org-1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [entry('e1', '2026-06-01', 8, 'Design review'), entry('e2', '2026-06-02', 7.5, 'Site handover')],
  },
  {
    id: 'previous', status: 'Approved', week_start_date: '2026-05-25', user_id: 'eng-1', org_id: 'org-1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [entry('e0', '2026-05-25', 40, 'Earlier work', 'previous')],
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
  return <output aria-label="Current path">{location.pathname}{location.search}</output>;
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

const timesheetCard = () => screen.getByTestId('engineer-timesheet');
const tasksCard = () => screen.getByTestId('engineer-tasks');

describe('Engineer home (one question: is my week on track?)', () => {
  it('shows task rows while the organization day is pending and date-based cards wait for it', () => {
    state.orgDay = { day: null, isPending: true, isError: false, retry: vi.fn() };
    renderDashboard();

    // The person's work is never hidden behind the day read: the rows show, just without date words.
    expect(within(tasksCard()).getByRole('link', { name: /Finalize drawings/ })).toBeInTheDocument();
    expect(within(tasksCard()).getByRole('link', { name: /Finalize drawings/ })).toHaveAttribute('href', '/projects/p1/tasks?open=overdue');
    expect(within(tasksCard()).queryByText(/days overdue/)).not.toBeInTheDocument();
    expect(within(tasksCard()).queryByText(/^Due /)).not.toBeInTheDocument();
    expect(within(timesheetCard()).getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('keeps timesheet figures visible when the task read fails', () => {
    state.tasks.data = undefined;
    state.tasks.isError = true;
    renderDashboard();

    expect(timesheetCard()).toHaveTextContent('15.5 h');
    expect(within(tasksCard()).getByText("Couldn't load your tasks")).toBeInTheDocument();
    expect(within(tasksCard()).queryByText('Finalize drawings')).not.toBeInTheDocument();
  });

  it('keeps task figures visible when the timesheet read fails', () => {
    state.timesheets.data = undefined;
    state.timesheets.isError = true;
    renderDashboard();

    expect(within(tasksCard()).getByRole('link', { name: /Finalize drawings/ })).toBeInTheDocument();
    expect(within(tasksCard()).getByTestId('engineer-tasks-overdue')).toHaveAttribute('href', '/my-tasks');
    expect(screen.queryByRole('link', { name: /Open timesheet entry for/ })).not.toBeInTheDocument();
  });

  it('keeps the task rows available when only the organization day read fails', () => {
    state.orgDay = { day: null, isPending: false, isError: true, retry: vi.fn() };
    renderDashboard();

    // What is late is unknown, so no date words; the work itself, and the way into it, stay.
    expect(within(tasksCard()).getByRole('link', { name: /Finalize drawings/ })).toBeInTheDocument();
    expect(within(tasksCard()).queryByText(/days overdue/)).not.toBeInTheDocument();
    expect(within(tasksCard()).queryByText(/^Due /)).not.toBeInTheDocument();
    // The failed day read still says so, with its own Retry.
    expect(within(tasksCard()).getByText("Couldn't read today's date")).toBeInTheDocument();
    expect(within(tasksCard()).getByRole('button', { name: /Retry|Try again/ })).toBeInTheDocument();
    expect(within(timesheetCard()).getByText("Couldn't load your timesheets")).toBeInTheDocument();
  });

  it('folds the overdue count into the My tasks header, with no separate waits band above it', () => {
    state.tasks.data = [
      { ...tasks[0] },
      { ...tasks[0], id: 'second-overdue', name: 'Review estimates', end_date: '2026-06-01' },
      { ...tasks[1] },
    ];
    renderDashboard();

    expect(within(tasksCard()).getByTestId('engineer-tasks-overdue')).toHaveTextContent('2 overdue');
    expect(screen.queryByTestId('waits-on-you')).not.toBeInTheDocument();
  });

  it('states the person\'s own overdue and due-today counts in the My tasks header', () => {
    state.tasks.data = [
      { id: 'late', name: 'Late task', status: 'In Progress', end_date: '2026-06-02' },
      { id: 'today', name: 'Today task', status: 'To Do', end_date: '2026-06-03' },
      { id: 'done-today', name: 'Done today', status: 'Done', end_date: '2026-06-03' },
      { id: 'later', name: 'Later task', status: 'To Do', end_date: '2026-06-04' },
    ];
    renderDashboard();

    // Both counts the old band carried are here, as links: overdue is the exception, due today is plain.
    expect(within(tasksCard()).getByTestId('engineer-tasks-overdue')).toHaveTextContent('1 overdue');
    expect(within(tasksCard()).getByTestId('engineer-tasks-overdue')).toHaveAttribute('href', '/my-tasks');
    expect(within(tasksCard()).getByTestId('engineer-tasks-overdue')).toHaveClass('text-destructive-text');
    expect(within(tasksCard()).getByTestId('engineer-tasks-due-today')).toHaveTextContent('1 due today');
    expect(within(tasksCard()).getByTestId('engineer-tasks-due-today')).toHaveAttribute('href', '/my-tasks');
    expect(within(tasksCard()).getByTestId('engineer-tasks-due-today')).toHaveClass('text-foreground');
  });

  it('counts one overdue task per task_status value except Done', () => {
    const overdueByStatus: Record<TaskStatus, { id: string; status: TaskStatus }> = {
      'To Do': { id: 'overdue-to-do', status: 'To Do' },
      'In Progress': { id: 'overdue-in-progress', status: 'In Progress' },
      Done: { id: 'overdue-done', status: 'Done' },
      Blocked: { id: 'overdue-blocked', status: 'Blocked' },
    };
    state.tasks.data = Object.values(overdueByStatus).map((task) => ({
      ...tasks[0],
      ...task,
      end_date: '2026-06-02',
    }));
    renderDashboard();

    const overdueFinding = within(tasksCard()).getByTestId('engineer-tasks-overdue');
    expect(overdueFinding).toHaveTextContent('3 overdue');
    fireEvent.click(overdueFinding);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/my-tasks');
  });

  it('states no overdue count when nothing is overdue', () => {
    state.tasks.data = [tasks[1]];
    const dueOnly = renderDashboard();
    expect(within(tasksCard()).queryByTestId('engineer-tasks-overdue')).not.toBeInTheDocument();
    dueOnly.unmount();

    state.tasks.data = [tasks[2]];
    renderDashboard();
    expect(tasksCard()).toHaveTextContent('No overdue tasks or tasks due this week.');
  });

  it('states the overdue finding in the shared late tone, with words not colour alone', () => {
    state.tasks.data = [
      { ...tasks[0] },
      { ...tasks[0], id: 'second-overdue', name: 'Review estimates', end_date: '2026-06-01' },
    ];
    renderDashboard();

    const finding = within(tasksCard()).getByTestId('engineer-tasks-overdue');
    expect(finding).toHaveTextContent('2 overdue');
    expect(finding).toHaveClass('text-destructive-text');
    // Exception colour once per group: the count, and the single most urgent row — the rest stay plain.
    expect(screen.getByText('3 days overdue')).toHaveClass('text-destructive-text');
    expect(screen.getByText('2 days overdue')).toHaveClass('text-foreground');
  });

  it('leads with My tasks, then my week, returned claims and recent entries; no company money', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { level: 1, name: 'My dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    const card = timesheetCard();
    expect(card).toHaveTextContent('15.5 h');
    expect(card).not.toHaveTextContent('99');
    expect(card).toHaveTextContent('Returned');
    expect(card).toHaveTextContent('Sent back for correction.');
    // The first block is the person's own work; the week's timesheet sits beside it.
    expect(tasksCard().compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(screen.getByTestId('engineer-returned')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/(?:Rp|USD|IDR|\$|invoice|budget|revenue|spending)/i);
  });

  it('draws the week as one Mon–Sun strip of hours with a dash for empty days', () => {
    renderDashboard();
    const strip = within(timesheetCard()).getByRole('list', { name: 'Hours by day this week' });
    const items = within(strip).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['Mon8', 'Tue7.5', 'Wed—', 'Thu—', 'Fri—', 'Sat—', 'Sun—']);
  });

  it('AC-IXD-DASH-W5-C2C-D4: one filled action into the timesheet — "Submit week" once there are hours, "Log time" when there are none, none once submitted', () => {
    state.timesheets.data = [{ ...sheets[1], status: 'Draft' }];
    const draft = renderDashboard();
    expect(within(timesheetCard()).getByRole('link', { name: 'Submit week' })).toHaveAttribute('href', '/timesheets');
    draft.unmount();

    state.timesheets.data = [{ ...sheets[1], status: 'Draft', entries: [] }];
    const empty = renderDashboard();
    expect(within(timesheetCard()).getByRole('link', { name: 'Log time' })).toHaveAttribute('href', '/timesheets');
    expect(within(timesheetCard()).getByText('0 h')).toBeInTheDocument();
    empty.unmount();

    state.timesheets.data = [{ ...sheets[1], status: 'Submitted' }];
    renderDashboard();
    expect(within(timesheetCard()).queryByRole('link', { name: /Submit week|Log time/ })).not.toBeInTheDocument();
    expect(within(timesheetCard()).getByRole('link', { name: 'Open timesheet' })).toHaveAttribute('href', '/timesheets');
  });

  it('lists overdue then this-week tasks (never done or later ones), each opening its project task drawer', () => {
    renderDashboard();
    const links = within(tasksCard()).getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/projects/'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/projects/p1/tasks?open=overdue', '/projects/p1/tasks?open=due']);
    expect(within(tasksCard()).queryByText('Close punch list')).not.toBeInTheDocument();
    expect(within(tasksCard()).queryByText('Plan next phase')).not.toBeInTheDocument();
    expect(within(tasksCard()).getByRole('link', { name: 'All tasks' })).toHaveAttribute('href', '/my-tasks');
  });

  it('N15: an overdue task says how late it is in red; a task due this week says its date', () => {
    renderDashboard();
    const overdue = screen.getByRole('link', { name: /Finalize drawings/ });
    const late = within(overdue).getByText('3 days overdue');
    expect(late).toHaveClass('text-destructive-text');
    expect(overdue).not.toHaveTextContent(/Due /);
    expect(screen.getByRole('link', { name: /Prepare handover/ })).toHaveTextContent(/Due /);
  });

  it('shows how late each overdue task is', () => {
    state.tasks.data = [
      { ...tasks[0], end_date: '2026-05-31' },
      { ...tasks[0], id: 'second-overdue', name: 'Review estimates', end_date: '2026-06-01' },
    ];
    renderDashboard();

    expect(within(screen.getByRole('link', { name: /Finalize drawings/ })).getByText('3 days overdue')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /Review estimates/ })).getByText('2 days overdue')).toBeInTheDocument();
  });

  it('N15: a task with no project still opens My Tasks', () => {
    state.tasks.data = [{ ...tasks[0], project_id: null, project_name: null }];
    renderDashboard();
    expect(screen.getByRole('link', { name: /Finalize drawings/ })).toHaveAttribute('href', '/my-tasks');
  });

  it('shows only the signed-in engineer\'s returned claims, and nothing at all when there are none', () => {
    const withClaims = renderDashboard();
    const returned = screen.getByTestId('engineer-returned');
    expect(within(returned).getByRole('link', { name: /Travel receipt/ })).toHaveAttribute('href', '/expenses?status=Rejected');
    expect(within(returned).queryByText('Open draft')).not.toBeInTheDocument();
    expect(within(returned).queryByText('Another person’s claim')).not.toBeInTheDocument();
    expect(within(returned).queryByText('Cash advance')).not.toBeInTheDocument();
    // The heading already says "returned": no second name for the same thing.
    expect(within(returned).queryByText('Rejected')).not.toBeInTheDocument();
    withClaims.unmount();

    state.expenses.data = { rows: [], truncated: false };
    renderDashboard();
    expect(screen.queryByTestId('engineer-returned')).not.toBeInTheDocument();
  });

  it('T9: shows up to 5 recent entries, opens Timesheets from one, with its description and status', () => {
    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Recent entries' })).toBeInTheDocument();
    const row = screen.getByRole('link', { name: /Open timesheet entry for Cedar Works: Site handover/ });
    // One compact row: date and hours, then project and description; no repeated field labels.
    expect(row).toHaveTextContent(/2 Jun · 7\.5 h/);
    expect(row).toHaveTextContent('Cedar Works · Site handover');
    expect(row).toHaveTextContent('Returned');
    expect(screen.queryByText('Project and description')).not.toBeInTheDocument();
    expect(screen.queryByText('Future week')).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/timesheets');
    cleanup();

    const many = Array.from({ length: 10 }, (_, index) => entry(`old-${index}`, `2026-05-${String(20 + index).padStart(2, '0')}`, 1, `Task ${index}`, 'previous'));
    state.timesheets.data = [{ ...sheets[2], entries: many }];
    renderDashboard();
    expect(screen.getAllByRole('link', { name: /^Open timesheet entry for/ })).toHaveLength(5);
  });

  it('refreshes the owned sources, and keeps loading and error states retryable', () => {
    const refresh = renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.timesheets.refetch).toHaveBeenCalledOnce();
    expect(state.tasks.refetch).toHaveBeenCalledOnce();
    expect(state.expenses.refetch).toHaveBeenCalledOnce();
    expect(state.orgDay.retry).toHaveBeenCalledOnce();
    refresh.unmount();

    state.timesheets.data = undefined;
    state.timesheets.isPending = true;
    state.tasks.data = undefined;
    state.tasks.isPending = true;
    state.expenses.data = undefined;
    state.expenses.isPending = true;
    const loading = renderDashboard();
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    // The way into the timesheet is there even while the data loads.
    expect(within(timesheetCard()).getByRole('link', { name: 'Log time' })).toHaveAttribute('href', '/timesheets');
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
    expect(within(timesheetCard()).getByRole('link', { name: 'Log time' })).toHaveAttribute('href', '/timesheets');
  });

  it('shows a genuine zero, not a dash, when no hours are logged; and no week figure when the source is unavailable', () => {
    state.timesheets.data = [{ ...sheets[1], entries: [] }];
    const zero = renderDashboard();
    expect(timesheetCard()).toHaveTextContent('0 h');
    zero.unmount();

    state.timesheets.data = undefined;
    renderDashboard();
    expect(timesheetCard()).not.toHaveTextContent('0 h');
    expect(screen.queryByText('Mon')).not.toBeInTheDocument();
  });

  it('with no timesheet this week there is no status pill and the action is Log time', () => {
    state.timesheets.data = sheets.filter((sheet) => sheet.week_start_date !== '2026-06-01');
    renderDashboard();
    expect(timesheetCard()).not.toHaveTextContent('Returned');
    expect(within(timesheetCard()).getByRole('link', { name: 'Log time' })).toBeInTheDocument();
  });

  it('AC-UXA-002: localizes the title, cards, week strip, statuses and actions while retaining data', () => {
    renderDashboard('id');
    expect(screen.getByRole('heading', { level: 1, name: 'Dasbor saya' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lembar waktu minggu ini' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tugas saya' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dikembalikan ke saya' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entri terbaru' })).toBeInTheDocument();
    expect(timesheetCard()).toHaveTextContent('Dikembalikan');
    expect(within(timesheetCard()).getByRole('list', { name: 'Jam per hari minggu ini' })).toHaveTextContent('Sen8');
    // Data is translated for display only.
    expect(sheets[1].entries[0].hours).toBe(8);
    expect(sheets[1].status).toBe('Rejected');

    for (const [status, label] of [['Draft', 'Draf'], ['Submitted', 'Diajukan'], ['Approved', 'Disetujui']] as const) {
      cleanup();
      state.timesheets.data = [{ ...sheets[1], status }];
      renderDashboard('id');
      expect(timesheetCard()).toHaveTextContent(label);
    }

    cleanup();
    state.timesheets.data = [];
    renderDashboard('id');
    expect(within(timesheetCard()).getByRole('link', { name: 'Catat waktu' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByText('Belum ada entri waktu terbaru')).toBeInTheDocument();
  });
});

describe('Engineer home — Overview layout', () => {
  beforeEach(() => { localStorage.setItem('home-layout', 'overview'); });

  it('draws the week as a column chart (Mon–Sun) beside my tasks, and the hours by project as one bar', () => {
    renderDashboard();
    const label = within(timesheetCard()).getByRole('img', { name: /^Hours by day this week\./ }).getAttribute('aria-label');
    expect(label).toBe('Hours by day this week. Mon: 8; Tue: 7.5; Wed: ; Thu: ; Fri: ; Sat: ; Sun: ');
    expect(within(timesheetCard()).getByText('15.5 h')).toBeInTheDocument();
    const hours = screen.getByTestId('chart-hours-by-project');
    expect(hours).toHaveTextContent('Cedar Works');
    expect(within(hours).getByRole('img')).toHaveAccessibleName('Hours by project this week. Cedar Works 15.5');
    expect(within(timesheetCard()).queryByRole('list', { name: 'Hours by day this week' })).not.toBeInTheDocument();
  });

  it('keeps the filled action and the returned claims, and leaves the project chart out (counted) when no time is logged', async () => {
    state.timesheets.data = [{ ...sheets[1], status: 'Draft', entries: [] }];
    renderDashboard();
    expect(within(timesheetCard()).getByRole('link', { name: 'Log time' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByTestId('engineer-returned')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-hours-by-project')).not.toBeInTheDocument();
    await openHiddenReasons();
    expect(await screen.findByText('no time is logged this week')).toBeInTheDocument();
  });

  it('an unknown stored layout is Overview; Focused keeps the strip and no project chart', () => {
    localStorage.setItem('home-layout', 'sideways');
    const first = renderDashboard();
    expect(screen.getByTestId('chart-hours-by-project')).toBeInTheDocument();
    first.unmount();
    localStorage.setItem('home-layout', 'focused');
    renderDashboard();
    expect(within(timesheetCard()).getByRole('list', { name: 'Hours by day this week' })).toBeInTheDocument();
    expect(screen.queryByTestId('chart-hours-by-project')).not.toBeInTheDocument();
  });

  it('floor: the hours-by-project Retry re-reads the timesheets', () => {
    state.timesheets.data = undefined;
    state.timesheets.isError = true;
    renderDashboard();
    fireEvent.click(within(screen.getByTestId('chart-hours-by-project')).getByRole('button', { name: /Retry|Try again/ }));
    expect(state.timesheets.refetch).toHaveBeenCalled();
  });
});

// Step 0 of the screen repair: every control this screen offers acts. These pin the floor that the
// recomposition must keep working; they assert the outcome (the route the person lands on, the read
// that is re-run), never the arrangement of the blocks.
describe('Engineer home — floor: every control acts', () => {
  const path = () => screen.getByLabelText('Current path').textContent;

  it('opens the timesheet from whichever action this week offers', () => {
    state.timesheets.data = [{ ...sheets[1], status: 'Draft' }];
    const submit = renderDashboard();
    fireEvent.click(within(timesheetCard()).getByRole('link', { name: 'Submit week' }));
    expect(path()).toContain('/timesheets');
    submit.unmount();

    state.timesheets.data = [{ ...sheets[1], status: 'Draft', entries: [] }];
    const log = renderDashboard();
    fireEvent.click(within(timesheetCard()).getByRole('link', { name: 'Log time' }));
    expect(path()).toContain('/timesheets');
    log.unmount();

    state.timesheets.data = [{ ...sheets[1], status: 'Submitted' }];
    renderDashboard();
    fireEvent.click(within(timesheetCard()).getByRole('link', { name: 'Open timesheet' }));
    expect(path()).toContain('/timesheets');
  });

  it('opens My Tasks from All tasks', () => {
    renderDashboard();
    fireEvent.click(within(tasksCard()).getByRole('link', { name: 'All tasks' }));
    expect(path()).toContain('/my-tasks');
  });

  it('opens a task in its project task drawer, with that task open', () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('link', { name: /Finalize drawings/ }));
    expect(path()).toContain('/projects/p1/tasks?open=overdue');
  });

  it('opens Expenses on the returned filter from a returned claim and from All returned', () => {
    const claim = renderDashboard();
    fireEvent.click(within(screen.getByTestId('engineer-returned')).getByRole('link', { name: /Travel receipt/ }));
    expect(path()).toContain('/expenses?status=Rejected');
    claim.unmount();

    renderDashboard();
    fireEvent.click(within(screen.getByTestId('engineer-returned')).getByRole('link', { name: 'All returned' }));
    expect(path()).toContain('/expenses?status=Rejected');
  });

  it('opens Timesheets from All timesheets', () => {
    renderDashboard();
    fireEvent.click(within(screen.getByTestId('engineer-recent')).getByRole('link', { name: 'All timesheets' }));
    expect(path()).toContain('/timesheets');
  });

  it('opens My Tasks from the own overdue and due-today counts', () => {
    state.tasks.data = [
      { id: 'late', name: 'Late task', status: 'In Progress', end_date: '2026-06-02' },
      { id: 'today', name: 'Today task', status: 'To Do', end_date: '2026-06-03' },
    ];
    const overdue = renderDashboard();
    fireEvent.click(within(tasksCard()).getByTestId('engineer-tasks-overdue'));
    expect(path()).toContain('/my-tasks');
    overdue.unmount();

    renderDashboard();
    fireEvent.click(within(tasksCard()).getByTestId('engineer-tasks-due-today'));
    expect(path()).toContain('/my-tasks');
  });

  it('re-reads the organization day from the date-unread Retry in My tasks', () => {
    state.orgDay = { day: null, isPending: false, isError: true, retry: vi.fn() };
    renderDashboard();
    fireEvent.click(within(tasksCard()).getByRole('button', { name: /Retry|Try again/ }));
    expect(state.orgDay.retry).toHaveBeenCalled();
  });

  it('re-reads the timesheet from its own card Retry', () => {
    state.timesheets.data = undefined;
    state.timesheets.isError = true;
    renderDashboard();
    fireEvent.click(within(timesheetCard()).getByRole('button', { name: /Retry|Try again/ }));
    expect(state.timesheets.refetch).toHaveBeenCalled();
  });

  it('re-reads the tasks from the My tasks card Retry', () => {
    state.tasks.data = undefined;
    state.tasks.isError = true;
    renderDashboard();
    fireEvent.click(within(tasksCard()).getByRole('button', { name: /Retry|Try again/ }));
    expect(state.tasks.refetch).toHaveBeenCalled();
  });

  it('re-reads the recent entries from their own Retry', () => {
    state.timesheets.data = undefined;
    state.timesheets.isError = true;
    renderDashboard();
    fireEvent.click(within(screen.getByTestId('engineer-recent')).getByRole('button', { name: /Retry|Try again/ }));
    expect(state.timesheets.refetch).toHaveBeenCalled();
  });
});
