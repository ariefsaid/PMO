import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  findOpen: vi.fn(),
  create: vi.fn(),
  can: vi.fn(() => true),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { findOpenForRecord: h.findOpen, create: h.create } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.can }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, def?: string) => (typeof def === 'string' ? def : _k),
  }),
}));

import { FollowUpTaskButton } from './FollowUpTaskButton';

const renderIt = (props: Partial<React.ComponentProps<typeof FollowUpTaskButton>> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <FollowUpTaskButton type="expense_claim" recordId="c1" projectId="p1" defaultName="EXP-0007" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => { vi.clearAllMocks(); h.can.mockReturnValue(true); h.findOpen.mockResolvedValue(null); h.create.mockResolvedValue({ id: 'new' }); });

describe('AC-RLT-015 create-from-record', () => {
  it('with an open task already present it opens that task and offers no second', async () => {
    h.findOpen.mockResolvedValue({ id: 't9', name: 'Chase', project_id: 'p1' });
    renderIt();
    const link = await screen.findByRole('link', { name: 'Open follow-up task' });
    expect(link).toHaveAttribute('href', '/projects/p1/tasks#task-t9');
    expect(screen.queryByRole('button', { name: 'Create follow-up task' })).toBeNull();
  });

  it('a project-less open task is found through My tasks', async () => {
    h.findOpen.mockResolvedValue({ id: 't9', name: 'Chase it', project_id: null });
    renderIt();
    expect(await screen.findByRole('link', { name: 'Open follow-up task' })).toHaveAttribute('href', '/my-tasks?q=Chase%20it');
  });

  it('with none it prefills the name and creates a task carrying exactly that record link', async () => {
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Create follow-up task' }));
    expect(screen.getByLabelText(/What needs following up/)).toHaveValue('EXP-0007');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create).toHaveBeenCalledWith({
      project_id: 'p1', name: 'EXP-0007', status: 'To Do', assignee_id: 'u1', expense_claim_id: 'c1',
    });
  });

  it('a finished record offers no new task', async () => {
    renderIt({ finished: true });
    await waitFor(() => expect(h.findOpen).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Create follow-up task' })).toBeNull();
  });

  it('shows nothing to someone who may not create tasks', () => {
    h.can.mockReturnValue(false);
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });
});
