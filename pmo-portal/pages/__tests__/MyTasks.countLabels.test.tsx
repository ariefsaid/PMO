import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * Judging my-tasks #1 (Emphasis: exception colour once, on the group's count) — the strip used to
 * show two bare figures, "17" and a red "15", so the reader had to guess that the second one meant
 * overdue work. The figures now carry their words: "17 Open · 15 Overdue".
 *
 * Owning layer: component (RTL).
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { tasksState } = vi.hoisted(() => ({
  tasksState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => tasksState,
  useMyTaskMutations: () => ({
    updateStatus: { mutate: vi.fn(), isPending: false },
  }),
}));

import MyTasks from '../MyTasks';

const renderMyTasks = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
        <ToastProvider>
          <MyTasks />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const twoLate = [
  { id: 'a', name: 'Chase the permit office', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'Northwind ERP', start_date: null, end_date: '2024-01-01' },
  { id: 'b', name: 'Review design specs', status: 'In Progress', assignee_id: 'u-self', project_id: 'p1', project_name: 'Northwind ERP', start_date: null, end_date: '2025-06-01' },
  { id: 'c', name: 'Prepare the agenda', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'Northwind ERP', start_date: null, end_date: '2099-12-31' },
];

beforeEach(() => {
  tasksState.data = twoLate;
  tasksState.isPending = false;
  tasksState.isError = false;
});

describe('My tasks — the counts say what they count (judging move 1)', () => {
  it('move 1: the strip reads "3 Open · 2 Overdue", not two unlabelled figures', () => {
    renderMyTasks();
    const strip = screen.getByTestId('my-tasks-waiting-summary');
    expect(within(strip).getByTestId('my-tasks-open-count')).toHaveTextContent('3');
    expect(within(strip).getByTestId('my-tasks-overdue-count')).toHaveTextContent('2 Overdue');
    // One line, in reading order: the figure, its word, then the late figure and its word.
    expect(strip).toHaveTextContent('3 Open · 2 Overdue');
  });

  it('move 1: the open figure still names itself for assistive tech without saying the word twice', () => {
    renderMyTasks();
    const figure = screen.getByTestId('my-tasks-open-count');
    expect(figure).toHaveAccessibleName('3 Open tasks');
    // The visible word is decoration for the name above, so it is not a second announcement.
    expect(figure).toHaveTextContent(/^3$/);
  });

  it('move 1: with nothing late the strip states only how many are open — no empty "0 Overdue"', () => {
    tasksState.data = [
      { id: 'c', name: 'Prepare the agenda', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'Northwind ERP', start_date: null, end_date: '2099-12-31' },
    ];
    renderMyTasks();
    const strip = screen.getByTestId('my-tasks-waiting-summary');
    expect(strip).toHaveTextContent('1 Open');
    expect(within(strip).queryByTestId('my-tasks-overdue-count')).not.toBeInTheDocument();
    expect(strip).not.toHaveTextContent(/Overdue/);
  });
});
