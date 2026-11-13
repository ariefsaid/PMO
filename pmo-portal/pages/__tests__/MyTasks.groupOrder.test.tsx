import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * Judging my-tasks #2 (Order: off track, worst first) — the queue answered "what do I work on now"
 * with its worst task buried in the second group, because groups followed the read's creation order.
 * The group holding the most overdue row now leads, and the one emphasised late row is that worst
 * task's row: exception colour appears once on the screen.
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
  it('move 2: the project holding the most overdue task leads the queue', () => {
    renderMyTasks();
    const groups = screen.getAllByRole('region');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Beta Works',
      'Alpha Works',
      'Gamma Works',
      'Delta Works',
    ]);
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
