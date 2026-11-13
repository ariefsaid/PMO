import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// Same harness as MilestoneStrip.deleteConfirm.test.tsx — the strip runs for real,
// only its milestone reads and writes are faked.
const milestoneState = vi.hoisted(() => ({
  data: [] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
const milestoneMutations = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
}));

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

const milestone = {
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
} as MilestoneWithProgress;

const render$ = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <MilestoneStrip projectId="p1" />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  milestoneState.data = [milestone];
  milestoneState.isPending = false;
  milestoneState.isError = false;
  milestoneMutations.create.mutateAsync.mockReset();
  milestoneMutations.create.mutateAsync.mockResolvedValue(undefined);
  milestoneMutations.update.mutateAsync.mockReset();
  milestoneMutations.update.mutateAsync.mockResolvedValue(undefined);
  milestoneMutations.remove.mutateAsync.mockReset();
  milestoneMutations.remove.mutateAsync.mockResolvedValue(undefined);
});

describe('MilestoneStrip floor', () => {
  it('floor: Add phase saves a new phase with the entered name, date and weight', async () => {
    render$();

    await userEvent.click(screen.getByRole('button', { name: 'Add phase' }));
    await userEvent.type(screen.getByLabelText(/Phase name/i), 'Procurement');
    await userEvent.type(screen.getByLabelText(/Target date/i), '2026-12-31');
    await userEvent.clear(screen.getByLabelText(/Relative weight/i));
    await userEvent.type(screen.getByLabelText(/Relative weight/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /Save phase|Create phase/ }));

    await waitFor(() => expect(milestoneMutations.create.mutateAsync).toHaveBeenCalledWith({
      input: expect.objectContaining({ name: 'Procurement', target_date: '2026-12-31', weight: 2 }),
    }));
  });

  it('floor: Edit phase opens prefilled and saves the changed name as an update', async () => {
    render$();

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Engineering design' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit phase', exact: true }));

    expect(screen.getByLabelText(/Phase name/i)).toHaveValue('Engineering design');
    await userEvent.clear(screen.getByLabelText(/Phase name/i));
    await userEvent.type(screen.getByLabelText(/Phase name/i), 'Detailed design');
    await userEvent.click(screen.getByRole('button', { name: /Save phase/i }));

    await waitFor(() => expect(milestoneMutations.update.mutateAsync).toHaveBeenCalledWith({
      id: 'm1',
      patch: expect.objectContaining({ name: 'Detailed design' }),
    }));
  });
});
