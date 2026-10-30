/**
 * AC-1402 — row activation opens the shared Drawer; edit remains a separate permission-gated action.
 * Clicking ⋯ → Delete does not open the Drawer. Readers can open comments and history regardless
 * of their task edit permission.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { listState, profilesState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  profilesState: { data: [] as unknown[], isPending: false, isError: false },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => listState,
  useAssignableProfiles: () => profilesState,
  useTaskMutations: () => mutations,
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => <div>Task comments</div> }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => <div>Task history</div> }));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
let currentUserId = 'pm-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' }, role: realRole }),
}));

import TasksTab from '../tabs/TasksTab';
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';

const profiles = [
  { id: 'eng-1', full_name: 'Dana Engineer', role: 'Engineer' },
  { id: 'pm-1', full_name: 'Pat Manager', role: 'Project Manager' },
];

const seed = [
  {
    id: 't1',
    project_id: 'p1',
    name: 'Survey the site',
    status: 'To Do',
    assignee_id: 'eng-1',
    start_date: null,
    end_date: '2026-06-20',
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    assignee: { id: 'eng-1', full_name: 'Dana Engineer' },
    dependencies: [],
  },
];

const renderTab = (role: Role = 'Project Manager', userId = 'pm-1') => {
  realRole = role;
  currentUserId = userId;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/tasks']}>
        <ToastProvider>
          <TasksTab projectId="p1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
    clearOwnershipCache();
    setTaskOwnership([]);
    setProjectBindings([]);
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  profilesState.data = profiles;
  profilesState.isPending = false;
  profilesState.isError = false;
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Project Manager';
  currentUserId = 'pm-1';
});

describe('TasksTab — row click opens the shared task drawer (AC-1402)', () => {
  it('AC-1402: clicking a task row opens the shared drawer with details, comments, history and full record link', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByText('Survey the site').closest('tr')!);
    const dialog = await screen.findByRole('dialog', { name: 'Survey the site' });
    expect(within(dialog).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(dialog).getByText('Task comments')).toBeInTheDocument();
    expect(within(dialog).getByText('Task history')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/projects/p1/tasks#task-t1');
    // Rare actions sit in the drawer header's ⋯ menu, like every record drawer.
    await userEvent.click(within(dialog).getByRole('button', { name: 'More task actions' }));
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('AC-W6-IXD-TASKROW: the drawer Edit action opens the edit form pre-filled with that task', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByText('Survey the site').closest('tr')!);
    const drawer = await screen.findByRole('dialog', { name: 'Survey the site' });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: /Edit task/i });
    expect(within(dialog).getByLabelText(/task name/i)).toHaveValue('Survey the site');
  });

  it('B1: the task drawer matches the other record drawers — wide, with Edit as the main header action', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByText('Survey the site').closest('tr')!);
    const dialog = await screen.findByRole('dialog', { name: 'Survey the site' });
    expect(dialog.className).toContain('md:w-[min(560px,92vw)]');
    expect(dialog.className).toContain('max-md:w-full');
    const edit = within(dialog).getByRole('button', { name: 'Edit' });
    const fullPage = within(dialog).getByRole('link', { name: 'Open full page' });
    const more = within(dialog).getByRole('button', { name: 'More task actions' });
    expect(edit.compareDocumentPosition(fullPage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fullPage.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(edit.className).toContain('bg-primary');
  });

  it('AC-1402: pressing Enter on the row activation button opens the drawer', async () => {
    renderTab('Project Manager');
    const activation = screen.getByRole('button', { name: 'Open task Survey the site' });
    activation.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Survey the site' })).toBeInTheDocument();
  });

  it('AC-1402: the activation button is available to readers who cannot edit', () => {
    renderTab('Engineer', 'eng-1');
    expect(screen.getByRole('button', { name: 'Open task Survey the site' })).toBeInTheDocument();
  });

  it('AC-W6-IXD-TASKROW: clicking ⋯ → Delete does NOT open the edit modal (stopPropagation)', async () => {
    renderTab('Admin');
    const row = screen.getByText('Survey the site').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    // A destructive confirm appears, not the edit dialog.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Survey the site' })).not.toBeInTheDocument();
  });

  it('AC-1402: Engineer can open a task drawer but does not get the Edit action on another user\'s task', async () => {
    renderTab('Engineer', 'eng-1');
    await userEvent.click(screen.getByRole('button', { name: 'Open task Survey the site' }));
    const dialog = await screen.findByRole('dialog', { name: 'Survey the site' });
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
