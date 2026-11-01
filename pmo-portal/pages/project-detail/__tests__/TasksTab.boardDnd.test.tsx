import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';
import { AppError } from '@/src/lib/appError';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Board drag on the REAL TasksTab (DND, #1637). jsdom cannot drive dnd-kit sensors, so the drop is
 * driven through the BoardDnd seam (the board's own `onMove` / `canDrop`); the real pointer path is
 * proven in AC-DND-015. Only the repository seam, auth and milestones are controlled.
 */
const dnd = vi.hoisted(() => ({
  props: null as null | { onMove: (c: string, k: string) => void; canDrop: (c: string, k: string) => boolean; isHome: (c: string, k: string) => boolean },
}));
vi.mock('@/src/components/kanban/BoardDnd', () => ({
  BoardDnd: (p: { children: React.ReactNode; onMove: never; canDrop: never; isHome: never }) => { dnd.props = p; return <>{p.children}</>; },
  DroppableColumn: ({ children, testId }: { children: (s: undefined) => React.ReactNode; testId?: string }) => <div data-testid={testId}>{children(undefined)}</div>,
  DraggableCard: ({ children, moveState, disabled }: { children: React.ReactNode; moveState?: string | null; disabled?: boolean }) => (
    <div data-drag-state={moveState ?? undefined} data-drag-disabled={disabled ? 'true' : undefined}>{children}</div>
  ),
}));

const { taskRepo, taskState } = vi.hoisted(() => ({
  taskRepo: {
    list: vi.fn(), updateStatus: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    addDependency: vi.fn(), removeDependency: vi.fn(),
  },
  taskState: { current: [] as Array<Record<string, unknown>> },
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { task: taskRepo, profile: { listOrgProfiles: vi.fn(async () => []) } },
}));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

import TasksTab from '../tabs/TasksTab';

const seedTask = {
  id: 't1', project_id: 'p1', name: 'Survey the site', status: 'To Do', assignee_id: 'eng-1',
  start_date: null, end_date: null, org_id: 'org-1', created_at: '2026-01-01T00:00:00Z',
  assignee: { id: 'eng-1', full_name: 'Dana Engineer' }, dependencies: [],
};

const renderBoard = (role: Role, userId: string, external = false) => {
  setTaskOwnership(external ? [{ domain: 'tasks', externalTier: 'clickup' }] : []);
  setProjectBindings(external ? [{ projectId: 'p1', externalTier: 'clickup' }] : []);
  realRole = role;
  currentUserId = userId;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/p1/tasks?view=board&scope=all']}>
        <ToastProvider><TasksTab projectId="p1" /></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const drop = (id: string, col: string) => act(async () => { dnd.props!.onMove(id, col); });
const cardIn = (status: string) => within(screen.getByTestId(`task-col-${status}`)).queryByText('Survey the site');

beforeEach(() => {
  taskState.current = [{ ...seedTask }];
  for (const [k, m] of Object.entries(taskRepo)) {
    (m as ReturnType<typeof vi.fn>).mockReset();
    if (k === 'list') (m as ReturnType<typeof vi.fn>).mockImplementation(async () => taskState.current);
    else (m as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  }
});
afterEach(() => clearOwnershipCache());

describe('TasksTab board drag', () => {
  it('AC-DND-009: an Engineer drops their own task To Do → In Progress: written with no confirm, "Status updated" shown', async () => {
    renderBoard('Engineer', 'eng-1');
    await screen.findByTestId('task-col-To Do');
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    await drop('t1', 'In Progress');
    await waitFor(() => expect(taskRepo.updateStatus).toHaveBeenCalledWith('t1', 'In Progress', 'p1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByText('Status updated')).toBeInTheDocument();
  });

  it('AC-DND-009: a task assigned to someone else is not draggable for an Engineer', async () => {
    renderBoard('Engineer', 'eng-2');
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    expect(cardIn('To Do')!.closest('[data-drag-disabled]')).toHaveAttribute('data-drag-disabled', 'true');
    expect(dnd.props!.canDrop('t1', 'Done')).toBe(false);
    await drop('t1', 'Done');
    expect(taskRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('AC-DND-009: canDrop is true for another column and false for the card\'s own column', async () => {
    renderBoard('Project Manager', 'pm-1');
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    expect(dnd.props!.canDrop('t1', 'Done')).toBe(true);
    expect(dnd.props!.canDrop('t1', 'To Do')).toBe(false);
    await drop('t1', 'To Do');
    expect(taskRepo.updateStatus).not.toHaveBeenCalled();
  });

  it("AC-DND-012: a task's own column is home (no drop cue); another column is not", async () => {
    renderBoard('Project Manager', 'pm-1');
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    expect(dnd.props!.isHome('t1', 'To Do')).toBe(true);
    expect(dnd.props!.isHome('t1', 'Done')).toBe(false);
  });

  it('AC-DND-010: a failed task drop rolls the card back to its column and shows the classified error', async () => {
    const err = Object.assign(new Error('denied'), { code: '42501' });
    taskRepo.updateStatus.mockRejectedValueOnce(err);
    renderBoard('Project Manager', 'pm-1');
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    await drop('t1', 'Done');
    expect(await screen.findByText(classifyMutationError(err).headline)).toBeInTheDocument();
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    expect(cardIn('Done')).toBeNull();
    expect(document.querySelector('[data-drag-state]')).toBeNull();
  });

  it('AC-DND-010: an externally-owned drop that the dispatch rejects shows push-failed and the card goes back', async () => {
    taskRepo.updateStatus.mockRejectedValue(new AppError('ClickUp did not respond', 'external-unreachable'));
    renderBoard('Project Manager', 'pm-1', true);
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    await drop('t1', 'Done');
    expect(await screen.findByRole('status', { name: /push failed/i })).toBeInTheDocument();
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    expect(cardIn('Done')).toBeNull();
  });

  it('AC-DND-008: (tasks) success keeps the card in the target column, saving, until the tasks query refetches', async () => {
    renderBoard('Project Manager', 'pm-1');
    await waitFor(() => expect(cardIn('To Do')).toBeInTheDocument());
    let finishRefetch!: () => void;
    taskRepo.list.mockImplementation(() => new Promise((resolve) => {
      finishRefetch = () => resolve(taskState.current);
    }));
    await drop('t1', 'In Progress');
    await waitFor(() => expect(taskRepo.list).toHaveBeenCalledTimes(2));
    expect(cardIn('In Progress')!.closest('[data-drag-state]')).toHaveAttribute('data-drag-state', 'saving');
    expect(cardIn('To Do')).toBeNull();
    taskState.current = [{ ...seedTask, status: 'In Progress' }];
    await act(async () => { finishRefetch(); });
    await waitFor(() => expect(document.querySelector('[data-drag-state]')).toBeNull());
    expect(cardIn('In Progress')).toBeInTheDocument();
  });
});
