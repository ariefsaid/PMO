import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * Director ruling B6 (14 Nov): the row controls get their words back at both widths. A bare clock
 * is not "log time" and a bare speech bubble is not "comments", so each row control shows the word
 * with its icon beside it — the same label at 1440 and at 390, never an icon-only control with the
 * word hidden behind a hover.
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

describe('My tasks — row actions carry their words (Director B6)', () => {
  it('B6: Comments reads as a word beside its icon and still opens the drawer', async () => {
    renderMyTasks();
    const group = screen.getByRole('region', { name: 'Solar Phase 1' });
    const comments = within(group).getByRole('button', { name: 'Comments Wire the inverters' });
    // The word is the control's own painted label (one text node, no wrapper that a width could
    // hide), so both widths read "Comments" — not an icon with a hover hint.
    expect(comments.childNodes.length).toBeGreaterThan(0);
    expect([...comments.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim())
      .filter(Boolean)).toEqual(['Comments']);
    expect(comments).toHaveAttribute('title', 'Comments');
    await userEvent.click(comments);
    expect(await screen.findByTestId('comments-section')).toBeInTheDocument();
  });

  it('B6: Log time reads as a word beside its icon and still carries its project', () => {
    renderMyTasks();
    const group = screen.getByRole('region', { name: 'Solar Phase 1' });
    const logTime = within(group).getByRole('link', { name: 'Log time' });
    expect([...logTime.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim())
      .filter(Boolean)).toEqual(['Log time']);
    expect(logTime).toHaveAttribute('title', 'Log time');
    expect(logTime).toHaveAttribute('href', '/timesheets?project=p-abc');
  });

  it('B6: the row keeps all three controls — the status select is untouched', () => {
    renderMyTasks();
    const group = screen.getByRole('region', { name: 'Solar Phase 1' });
    expect(within(group).getByRole('combobox', { name: 'Change status of Wire the inverters' })).toHaveValue('In Progress');
    // Comments (the row's only button), the project heading, the task name and Log time.
    expect(within(group).getAllByRole('button')).toHaveLength(1);
    expect(within(group).getAllByRole('link')).toHaveLength(3);
  });
});
