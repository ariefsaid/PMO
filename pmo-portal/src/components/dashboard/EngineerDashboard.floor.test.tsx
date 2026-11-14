/**
 * EngineerDashboard floor rows: click-through navigation (task rows, all-links, timesheet
 * actions, returned claim row) and per-card Retry refetches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { EngineerDashboard } from './EngineerDashboard';
import { BahasaProvider } from '@/test/bahasa';
import { pinHomeLayout } from '@/test/homeLayout';

pinHomeLayout('overview');

const state = vi.hoisted(() => ({
  timesheets: { data: undefined as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  tasks: { data: undefined as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  expenses: { data: undefined as { rows: unknown[]; truncated: boolean } | undefined, isPending: false, isError: false, refetch: vi.fn() },
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

const entry = (id: string, entry_date: string, hours: number, notes: string | null, timesheetId = 'current') => ({
  id, hours, entry_date, project_id: 'p1', timesheet_id: timesheetId, org_id: 'org-1', notes,
  project: { name: 'Cedar Works', code: 'PRJ-1' },
});

const sheets = [
  {
    id: 'current', status: 'Rejected', week_start_date: '2026-06-01', user_id: 'eng-1', org_id: 'org-1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [entry('e1', '2026-06-01', 8, 'Design review'), entry('e2', '2026-06-02', 7.5, 'Site handover')],
  },
];

const tasks = [
  { id: 'overdue', name: 'Finalize drawings', status: 'In Progress', assignee_id: 'eng-1', project_id: 'p1', project_name: 'Cedar Works', start_date: null, end_date: '2026-05-31' },
  { id: 'due', name: 'Prepare handover', status: 'To Do', assignee_id: 'eng-1', project_id: 'p1', project_name: 'Cedar Works', start_date: null, end_date: '2026-06-04' },
];

const claims = [
  { id: 'returned', kind: 'claim', claimant_id: 'eng-1', status: 'Rejected', title: 'Travel receipt', project: { name: 'Cedar Works' }, updated_at: '2026-06-02' },
];

const PathProbe = ({ label }: { label: string }) => {
  const location = useLocation();
  return <output data-testid={label}>{location.pathname + location.search}</output>;
};

const renderDashboard = () => render(
  <BahasaProvider locale="en">
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<><EngineerDashboard /><PathProbe label="home-probe" /></>} />
        <Route path="/my-tasks" element={<PathProbe label="dest-tasks" />} />
        <Route path="/timesheets" element={<PathProbe label="dest-timesheets" />} />
        <Route path="/expenses" element={<PathProbe label="dest-expenses" />} />
        <Route path="/projects/:projectId/tasks" element={<PathProbe label="dest-drawer" />} />
      </Routes>
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
  state.needs = { items: [], isPending: false, isError: false, refetch: vi.fn() };
  state.orgDay = { day: '2026-06-03', isPending: false, isError: false, retry: vi.fn() };
  state.userId = 'eng-1';
});

afterEach(cleanup);

const user = () => userEvent.setup();

describe('EngineerDashboard floor', () => {
  it('floor: overdue and due-today task rows open their project task drawer', async () => {
    const u = user();
    renderDashboard();

    await u.click(screen.getByRole('link', { name: /Finalize drawings/ }));
    expect(screen.getByTestId('dest-drawer')).toHaveTextContent('/projects/p1/tasks?open=overdue');
    cleanup();

    renderDashboard();
    await u.click(screen.getByRole('link', { name: /Prepare handover/ }));
    expect(screen.getByTestId('dest-drawer')).toHaveTextContent('/projects/p1/tasks?open=due');
  });

  it('floor: the Waits-on-you Retry refetches the task read', async () => {
    state.tasks.isError = true;
    const u = user();
    renderDashboard();
    const waits = screen.getByTestId('waits-on-you');
    await u.click(within(waits).getByRole('button', { name: /retry|try again/i }));
    expect(state.tasks.refetch).toHaveBeenCalled();
  });

  it('floor: the week actions open /timesheets', async () => {
    const u = user();
    const draft = renderDashboard();
    // Draft with hours: Submit week.
    await u.click(within(screen.getByTestId('engineer-timesheet')).getByRole('link', { name: 'Submit week' }));
    expect(screen.getByTestId('dest-timesheets')).toBeInTheDocument();
    cleanup();

    // Empty draft: Log time.
    state.timesheets.data = [{ ...sheets[0], status: 'Draft', entries: [] }];
    renderDashboard();
    await u.click(within(screen.getByTestId('engineer-timesheet')).getByRole('link', { name: 'Log time' }));
    expect(screen.getByTestId('dest-timesheets')).toBeInTheDocument();
    draft.unmount();
    cleanup();

    // Submitted: Open timesheet.
    state.timesheets.data = [{ ...sheets[0], status: 'Submitted' }];
    renderDashboard();
    await u.click(within(screen.getByTestId('engineer-timesheet')).getByRole('link', { name: 'Open timesheet' }));
    expect(screen.getByTestId('dest-timesheets')).toBeInTheDocument();
  });

  it('floor: All tasks opens My Tasks', async () => {
    const u = user();
    renderDashboard();
    await u.click(within(screen.getByTestId('engineer-tasks')).getByRole('link', { name: 'All tasks' }));
    expect(screen.getByTestId('dest-tasks')).toHaveTextContent('/my-tasks');
  });

  it('floor: the returned claim row opens Expenses filtered to rejected', async () => {
    const u = user();
    renderDashboard();
    await u.click(screen.getByRole('link', { name: /Travel receipt/ }));
    expect(screen.getByTestId('dest-expenses')).toHaveTextContent('/expenses?status=Rejected');
  });

  it('floor: All returned opens Expenses filtered to rejected', async () => {
    const u = user();
    renderDashboard();
    const returned = screen.getByTestId('engineer-returned');
    await u.click(within(returned).getByRole('link', { name: /all returned/i }));
    expect(screen.getByTestId('dest-expenses')).toHaveTextContent('/expenses?status=Rejected');
  });

  it('floor: All timesheets opens /timesheets', async () => {
    const u = user();
    renderDashboard();
    await u.click(screen.getByRole('link', { name: /all timesheets/i }));
    expect(screen.getByTestId('dest-timesheets')).toBeInTheDocument();
  });

  it('floor: the hours chart Retry refetches the timesheet read', async () => {
    state.timesheets.isError = true;
    const u = user();
    renderDashboard();
    const chart = screen.getByTestId('chart-hours-by-project');
    await u.click(within(chart).getByRole('button', { name: /retry|try again/i }));
    expect(state.timesheets.refetch).toHaveBeenCalled();
  });

  it('floor: the timesheet panel Retry refetches the timesheet read', async () => {
    state.timesheets.isError = true;
    const u = user();
    renderDashboard();
    const card = screen.getByTestId('engineer-timesheet');
    await u.click(within(card).getByRole('button', { name: /retry|try again/i }));
    expect(state.timesheets.refetch).toHaveBeenCalled();
  });

  it('floor: the tasks panel Retry refetches the task read', async () => {
    state.tasks.isError = true;
    const u = user();
    renderDashboard();
    const card = screen.getByTestId('engineer-tasks');
    await u.click(within(card).getByRole('button', { name: /retry|try again/i }));
    expect(state.tasks.refetch).toHaveBeenCalled();
  });

  it('floor: the recent-entries Retry refetches the timesheet read', async () => {
    state.timesheets.isError = true;
    const u = user();
    renderDashboard();
    // The recent panel is the last retryable card in the overview layout.
    const retryButtons = screen.getAllByRole('button').filter((b) => /retry|try again/i.test(b.textContent ?? ''));
    await u.click(retryButtons[retryButtons.length - 1]!);
    expect(state.timesheets.refetch).toHaveBeenCalled();
  });
});
