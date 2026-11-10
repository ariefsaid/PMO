/**
 * #2061 — the phone Home ("my queue").
 *
 * Pins the two halves of the queue and the one data-path rule that matters: the page reads the
 * EXISTING hooks (`useMyTasks`, procurement/timesheet/expense/invoice awaiting hooks) and only an
 * approver's role mounts the approval reads at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import MyQueue from './MyQueue';
import type { MyTask } from '@/src/lib/db/tasks';

const state = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  canApprove: true,
  tasks: [] as MyTask[],
  tasksPending: false,
  tasksError: false,
  procurements: [] as unknown[],
  timesheets: [] as unknown[],
  expenses: [] as unknown[],
  invoices: [] as unknown[],
}));

const procurementReads = vi.hoisted(() => vi.fn());
const timesheetReads = vi.hoisted(() => vi.fn());

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-me', org_id: 'org-1' }, role: state.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
  useOptionalRealRole: () => state.role,
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => state.canApprove,
}));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-08' }));
vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => ({
    data: state.tasks,
    isPending: state.tasksPending,
    isError: state.tasksError,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: (opts?: unknown) => {
    procurementReads(opts);
    return { data: state.procurements, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => {
    timesheetReads();
    return { data: state.timesheets, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaimsAwaitingDecision: () => ({ data: state.expenses, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: state.invoices, isPending: false, isError: false, refetch: vi.fn() }),
}));

const task = (over: Partial<MyTask>): MyTask => ({
  id: 'task-1',
  name: 'Pour slab',
  status: 'In Progress',
  assignee_id: 'u-me',
  project_id: 'p-1',
  project_name: 'Northline',
  start_date: null,
  end_date: null,
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/home']}>
      <MyQueue />
    </MemoryRouter>,
  );

beforeEach(() => {
  state.role = 'Project Manager';
  state.canApprove = true;
  state.tasks = [];
  state.tasksPending = false;
  state.tasksError = false;
  state.procurements = [];
  state.timesheets = [];
  state.expenses = [];
  state.invoices = [];
  procurementReads.mockClear();
  timesheetReads.mockClear();
});

describe('#2061 my-queue Home', () => {
  it('lists the signed-in user’s open tasks with their project, due date and status', () => {
    state.tasks = [
      task({ id: 't-1', name: 'Pour slab', end_date: '2026-11-01' }),
      task({ id: 't-2', name: 'Check valves', status: 'To Do', project_name: 'Eastfield', end_date: '2026-12-01' }),
      task({ id: 't-3', name: 'Old work', status: 'Done' }),
    ];
    renderPage();

    expect(screen.getByRole('heading', { name: 'My queue' })).toBeInTheDocument();
    expect(screen.getByText('Pour slab')).toBeInTheDocument();
    expect(screen.getByText('Check valves')).toBeInTheDocument();
    // Completed work is history, not queue.
    expect(screen.queryByText('Old work')).not.toBeInTheDocument();
    expect(screen.getByText('Northline')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('To Do')).toBeInTheDocument();
  });

  it('lists everything awaiting the approver’s decision from the existing approval hooks', () => {
    state.procurements = [
      {
        id: 'pr-1',
        title: 'HV Cabling & Grid Connection Kit',
        status: 'Requested',
        requested_by_id: 'u-other',
        total_value: 250000000,
        currency: 'IDR',
        vendor: { name: 'Voltaic Supply' },
      },
    ];
    state.timesheets = [
      {
        id: 'ts-1',
        user_id: 'u-dave',
        week_start_date: '2026-11-02',
        status: 'Submitted',
        owner: { full_name: 'Dave Engineer', manager_id: null },
        entries: [{ hours: 8 }, { hours: 7.5 }],
      },
    ];
    state.expenses = [
      {
        claim: {
          id: 'exp-1',
          title: 'Site fuel',
          claim_number: 'EXP-0012',
          status: 'Submitted',
          claimant_id: 'u-other',
          amount: 450000,
          currency: 'IDR',
          created_at: '2026-11-05T00:00:00Z',
        },
        route: null,
      },
    ];
    state.invoices = [
      {
        id: 'inv-1',
        si_number: 'SI-0042',
        amount: 12000000,
        currency: 'IDR',
        customer_name: 'Redwood Transit Group',
        author_user_id: 'u-other',
        author_user_ids: ['u-other'],
        pmo_native: true,
      },
    ];
    renderPage();

    expect(screen.getByRole('heading', { name: 'Awaiting your approval' })).toBeInTheDocument();
    expect(screen.getByText('HV Cabling & Grid Connection Kit')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /HV Cabling & Grid Connection Kit/ })).toHaveAttribute(
      'href',
      '/procurement/pr-1',
    );
    expect(screen.getByText(/Timesheet week of/)).toBeInTheDocument();
    expect(screen.getByText('Site fuel')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Site fuel/ })).toHaveAttribute('href', '/expenses/exp-1');
    expect(screen.getByText('SI-0042')).toBeInTheDocument();
  });

  it('a viewer who cannot approve sees no approvals section and no approval reads fire', () => {
    state.canApprove = false;
    state.role = 'Engineer';
    state.procurements = [
      { id: 'pr-1', title: 'Hidden case', status: 'Requested', requested_by_id: 'u-other' },
    ];
    renderPage();

    expect(screen.queryByRole('heading', { name: 'Awaiting your approval' })).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden case')).not.toBeInTheDocument();
    expect(procurementReads).not.toHaveBeenCalled();
    expect(timesheetReads).not.toHaveBeenCalled();
  });

  it('points at the full lists when the queue is longer than the preview', () => {
    state.tasks = Array.from({ length: 8 }, (_, index) =>
      task({ id: `t-${index}`, name: `Task ${index}`, end_date: '2026-12-0' + ((index % 8) + 1) }),
    );
    renderPage();

    expect(screen.getByRole('link', { name: 'View all tasks' })).toHaveAttribute('href', '/my-tasks');
    expect(screen.getByRole('link', { name: 'Show all 8 open tasks' })).toHaveAttribute('href', '/my-tasks');
    expect(screen.getByText('Task 0')).toBeInTheDocument();
    expect(screen.queryByText('Task 7')).not.toBeInTheDocument();
  });
});
