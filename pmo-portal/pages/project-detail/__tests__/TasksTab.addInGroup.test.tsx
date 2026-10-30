/**
 * AC-DEL-011 — Adding a task inside a milestone group pre-populates milestone_id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Stubs ────────────────────────────────────────────────────────────────────

const m1: MilestoneWithProgress = {
  id: 'm1', project_id: 'p1', name: 'Engineering design', sort_order: 0,
  target_date: null, weight: 1, input_pct: null, task_count: 0,
  calculated_pct: null, effective_pct: 0,
};

const milestoneState = {
  data: [m1] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import TasksTab from '../tabs/TasksTab';

/** A phase's heading row and the text of every row up to the next phase heading (B7: phases share one table). */
function phase(name: RegExp) {
  const rows = within(screen.getByRole('table', { name: 'Project tasks' })).getAllByRole('row');
  const start = rows.findIndex((row) => within(row).queryByRole('rowheader', { name }));
  if (start === -1) throw new Error(`No phase heading ${name}`);
  const next = rows.findIndex((row, index) => index > start && within(row).queryByRole('rowheader'));
  return { heading: rows[start], text: rows.slice(start, next === -1 ? undefined : next).map((row) => row.textContent).join(' | ') };
}

const render$ = () => {
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

describe('TasksTab add task in group (AC-DEL-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-DEL-011: clicking "Add task" within the M1 group opens the modal with the milestone field pre-populated to M1\'s id', async () => {
    render$();

    // The Engineering design group should have an "Add task" button
    const addBtn = within(phase(/Engineering design/i).heading).getByRole('button', { name: /add task/i });
    fireEvent.click(addBtn);

    // Modal should open — wait for the dialog role to appear
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // The milestone combobox inside the dialog should show "Engineering design" as selected
    await waitFor(() => {
      // Scope to the dialog to avoid matching the group-heading text outside the modal
      const milestoneCombobox = within(dialog).getByRole('combobox', { name: /phase/i });
      expect(milestoneCombobox).toHaveTextContent('Engineering design');
    });
  });
});
