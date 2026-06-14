import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const milestoneState = {
  data: [
    {
      id: 'm1',
      project_id: 'p1',
      name: 'Engineering design',
      sort_order: 0,
      target_date: null,
      weight: 1,
      input_pct: 75,
      task_count: 5,
      calculated_pct: 60,
      effective_pct: 75,
    },
  ] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const removeSpy = vi.fn().mockResolvedValue(undefined);
const milestoneMutations = {
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: removeSpy, isPending: false },
  setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => milestoneMutations,
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import MilestoneStrip from '../MilestoneStrip';

const render$ = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <MilestoneStrip projectId="p1" />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('MilestoneStrip delete confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    removeSpy.mockResolvedValue(undefined);
  });

  it('AC-DEL-014: the per-phase overflow delete path opens the destructive confirm copy', () => {
    render$();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Engineering design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Engineering design' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Delete "Engineering design"?')).toBeInTheDocument();
    expect(
      screen.getByText('Tasks under this milestone become ungrouped; they are not deleted.'),
    ).toBeInTheDocument();
  });

  it('confirming delete calls remove.mutateAsync with milestone ID', async () => {
    render$();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Engineering design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Engineering design' }));

    const confirmBtn = screen.getByRole('button', { name: 'Delete milestone' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(removeSpy).toHaveBeenCalledWith('m1');
    });
  });
});
