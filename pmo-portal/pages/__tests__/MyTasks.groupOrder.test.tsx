import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * Judging my-tasks #2 (Order: off track, worst first) with the Director's B6 ruling: the queue
 * answers "what do I work on now", so its one stated rule is "the group holding the most overdue
 * task comes first". Two ties are stated, not left to chance: groups equally overdue keep the
 * read's order, and with nothing overdue the group with the soonest due date leads (undated last).
 * The one emphasised late row is that worst task's row: exception colour appears once on the screen.
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

const task = (
  id: string,
  name: string,
  projectId: string,
  projectName: string,
  endDate: string | null,
) => ({
  id,
  name,
  status: 'To Do',
  assignee_id: 'u-self',
  project_id: projectId,
  project_name: projectName,
  start_date: null,
  end_date: endDate,
});

/**
 * The read hands these over in creation order — Alpha first, the worst task's project (Beta) third.
 * Alpha is late but by months less than Beta; Gamma and Delta are not late at all.
 */
const seed = [
  task('alpha-late', 'Alpha late', 'p-alpha', 'Alpha Works', '2025-06-01'),
  task('alpha-soon', 'Alpha soon', 'p-alpha', 'Alpha Works', '2099-01-01'),
  task('gamma-soon', 'Gamma soon', 'p-gamma', 'Gamma Works', '2099-01-01'),
  task('beta-worst', 'Worst of all', 'p-beta', 'Beta Works', '2024-01-01'),
  task('beta-soon', 'Second in beta', 'p-beta', 'Beta Works', '2099-12-01'),
  task('delta-soon', 'Delta soon', 'p-delta', 'Delta Works', '2099-06-01'),
];

beforeEach(() => {
  tasksState.data = [...seed];
  tasksState.isPending = false;
  tasksState.isError = false;
  tasksState.refetch.mockClear();
});

describe('My tasks — worst first (judging move 2)', () => {
  it('move 2: the group holding the most overdue task comes first', () => {
    renderMyTasks();
    // The queue's groups, in reading order: the level-2 heading of each project section.
    // (Not `getAllByRole('region')`: the ToastProvider's Toaster root is itself a labelled
    // `<section>` — a region — so "every region on the page" is 5 entries, not the 4 groups.)
    const groupNames = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    // Beta holds the most overdue task (2024-01-01), Alpha the next (2025-06-01); neither Gamma nor
    // Delta is overdue, so they follow by soonest due date (2099-01-01 before 2099-06-01).
    expect(groupNames).toEqual(['Beta Works', 'Alpha Works', 'Gamma Works', 'Delta Works']);
  });

  it('move 2: groups that are equally overdue keep the read\'s order (the tie is the read)', () => {
    // Zulu is read first but is late by less than the tie; Beta and Yankee share the worst due date.
    tasksState.data = [
      task('zulu-late', 'Zulu late', 'p-zulu', 'Zulu Works', '2024-05-05'),
      task('beta-worst', 'Beta late', 'p-beta', 'Beta Works', '2024-01-01'),
      task('yankee-late', 'Yankee late', 'p-yankee', 'Yankee Works', '2024-01-01'),
      task('alpha-late', 'Alpha late', 'p-alpha', 'Alpha Works', '2024-06-01'),
    ];
    renderMyTasks();
    const groupNames = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    // Beta before Yankee: equal keys keep the order the read handed over, so the order is never arbitrary.
    expect(groupNames).toEqual(['Beta Works', 'Yankee Works', 'Zulu Works', 'Alpha Works']);
  });

  it('move 2: with nothing overdue, the soonest due date leads and an undated group trails', () => {
    tasksState.data = [
      task('undated', 'No date', 'p-undated', 'Undated Works', null),
      task('charlie-soon', 'Charlie soon', 'p-charlie', 'Charlie Works', '2099-06-01'),
      task('alpha-soon', 'Alpha soon', 'p-alpha', 'Alpha Works', '2099-01-01'),
      task('bravo-soon', 'Bravo soon', 'p-bravo', 'Bravo Works', '2099-01-01'),
    ];
    renderMyTasks();
    const groupNames = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    // Alpha and Bravo share the soonest date, so the read decides between them (Alpha was read first).
    expect(groupNames).toEqual(['Alpha Works', 'Bravo Works', 'Charlie Works', 'Undated Works']);
  });

  it('move 2: the worst row is the first row of the leading group', () => {
    renderMyTasks();
    const [leading, ...rest] = screen.getAllByRole('region');
    const leadingNames = within(leading).getAllByRole('link').map((link) => link.textContent);
    expect(leadingNames).toContain('Worst of all');
    const worst = screen.getByText('Worst of all');
    const runnerUp = screen.getByText('Alpha late');
    // Everything in the leading group is read before the next group's rows.
    expect(worst.compareDocumentPosition(runnerUp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rest.some((group) => within(group).queryByText('Worst of all'))).toBe(false);
  });

  it('move 2: the one emphasised late row is the worst task, not another late row', () => {
    renderMyTasks();
    const lateRows = screen.getAllByTestId(/^my-task-late-status-/);
    expect(lateRows).toHaveLength(2);
    const emphasised = lateRows.filter((row) => row.classList.contains('text-destructive-text'));
    expect(emphasised).toHaveLength(1);
    expect(emphasised[0]).toBe(screen.getByTestId('my-task-late-status-beta-worst'));
    // The row below it states its lateness in plain words, never a second red.
    expect(screen.getByTestId('my-task-late-status-alpha-late')).not.toHaveClass('text-destructive-text');
  });

  it('move 2: within a group the worst row still comes first', () => {
    renderMyTasks();
    const alpha = screen.getByRole('region', { name: 'Alpha Works' });
    const names = within(alpha).getAllByRole('link').map((link) => link.textContent);
    const lateIndex = names.indexOf('Alpha late');
    const soonIndex = names.indexOf('Alpha soon');
    expect(lateIndex).toBeGreaterThanOrEqual(0);
    expect(soonIndex).toBeGreaterThanOrEqual(0);
    expect(lateIndex).toBeLessThan(soonIndex);
  });
});
