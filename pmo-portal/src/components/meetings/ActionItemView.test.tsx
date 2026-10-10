import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { getTask } = vi.hoisted(() => ({ getTask: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { get: getTask } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { ActionItemView } from './ActionItemView';

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const task = {
  id: 't1',
  project_id: 'p1',
  name: 'Confirm crane schedule',
  status: 'In Progress',
  end_date: '2026-09-18',
  assignee: { id: 'p1', full_name: 'Putri Peer' },
};

describe('ActionItemView — the live row, never a copy (DD-MTG-2)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('AC-MTG-003 renders the task row’s CURRENT name, status and assignee', async () => {
    getTask.mockResolvedValue(task);
    wrap(<ActionItemView taskId="t1" />);
    expect(await screen.findByText('Confirm crane schedule')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Owner: Putri Peer')).toBeInTheDocument();
    expect(screen.getByText(/Due date:/)).toBeInTheDocument();
    expect(getTask).toHaveBeenCalledWith('t1');
  });

  it('AC-MTG-008 shows an explicit unassigned cue and a keyboard-accessible task link', async () => {
    getTask.mockResolvedValue({ ...task, assignee: null, end_date: null });
    wrap(<ActionItemView taskId="t1" />);
    const link = await screen.findByRole('link', { name: 'Open task: Confirm crane schedule' });
    expect(link).toHaveAttribute('href', '/projects/p1/tasks#task-t1');
    expect(screen.getByText('Unassigned — assign an owner')).toBeInTheDocument();
  });

  it('AC-MTG-003 reopening after the task changed elsewhere shows the new values', async () => {
    getTask.mockResolvedValue({ ...task, name: 'Renamed in the task list', assignee: null });
    wrap(<ActionItemView taskId="t1" />);
    expect(await screen.findByText('Renamed in the task list')).toBeInTheDocument();
    expect(screen.queryByText('Putri Peer')).not.toBeInTheDocument();
  });

  it('AC-MTG-005 a task that no longer resolves renders a tombstone — no crash, not blank', async () => {
    getTask.mockResolvedValue(null);
    wrap(<ActionItemView taskId="gone" />);
    const tomb = await screen.findByTestId('action-item-tombstone');
    expect(tomb).toHaveTextContent(/no longer available/i);
  });

  it('AC-MTG-008 an empty taskId is a tombstone and performs NO lookup and NO write', async () => {
    wrap(<ActionItemView taskId="" />);
    expect(await screen.findByTestId('action-item-tombstone')).toBeInTheDocument();
    expect(getTask).not.toHaveBeenCalled();
  });

  it('a failed lookup is an error state, distinct from a tombstone', async () => {
    getTask.mockImplementation(async () => { throw new Error('network'); });
    wrap(<ActionItemView taskId="t1" />);
    expect(await screen.findByTestId('action-item-error')).toBeInTheDocument();
    expect(screen.queryByTestId('action-item-tombstone')).not.toBeInTheDocument();
  });
});
