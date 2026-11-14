import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * Judging my-tasks #3 (Example: ERPNext list — row actions quiet) — Comments and Log time repeated
 * as two outlined word buttons on every row: 51 controls of equal weight down the queue. They are
 * now quiet icon controls in the row, keeping the exact action and the exact accessible name, so a
 * screen-reader user still hears "Comments <task>" and "Log time".
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

vi.mock('@/src/lib/db/comments', () => ({
  listComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn(),
  archiveComment: vi.fn(),
}));
vi.mock('@/src/hooks/useTasks', async (orig) => ({
  ...(await orig<object>()),
  useAssignableProfiles: () => ({ data: [] }),
}));

import MyTasks from '../MyTasks';

const renderMyTasks = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole="Engineer">
        <MemoryRouter initialEntries={['/my-tasks']}>
          <ToastProvider>
            <MyTasks />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

const task = {
  id: 't-1',
  name: 'Wire the inverters',
  status: 'In Progress',
  assignee_id: 'u-self',
  project_id: 'p-abc',
  project_name: 'Solar Phase 1',
  start_date: null,
  end_date: '2099-12-31',
  priority: null,
  archived_at: null,
};

beforeEach(() => {
  tasksState.data = [task];
  tasksState.isPending = false;
  tasksState.isError = false;
});

describe('My tasks — quiet row actions (judging move 3)', () => {
  it('move 3: Comments is an icon control that still names its row and opens the drawer', async () => {
    renderMyTasks();
    const group = screen.getByRole('region', { name: 'Solar Phase 1' });
    const comments = within(group).getByRole('button', { name: 'Comments Wire the inverters' });
    // No repeated word on every row — the name lives on the control, plus its hover text.
    expect(comments.textContent).toBe('');
    expect(comments).toHaveAttribute('title', 'Comments');
    await userEvent.click(comments);
    expect(await screen.findByTestId('comments-section')).toBeInTheDocument();
  });

  it('move 3: Log time is an icon link carrying the name it always had', () => {
    renderMyTasks();
    const group = screen.getByRole('region', { name: 'Solar Phase 1' });
    const logTime = within(group).getByRole('link', { name: 'Log time' });
    expect(logTime.textContent).toBe('');
    expect(logTime).toHaveAttribute('title', 'Log time');
    expect(logTime).toHaveAttribute('href', '/timesheets?project=p-abc');
  });

  it('move 3: the row keeps all three controls — the status select is untouched', () => {
    renderMyTasks();
    const group = screen.getByRole('region', { name: 'Solar Phase 1' });
    expect(within(group).getByRole('combobox', { name: 'Change status of Wire the inverters' })).toHaveValue('In Progress');
    // Comments (the row's only button), the project heading, the task name and Log time.
    expect(within(group).getAllByRole('button')).toHaveLength(1);
    expect(within(group).getAllByRole('link')).toHaveLength(3);
  });
});
