import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const updateSpy = vi.fn().mockResolvedValue(undefined);
const milestoneMutations = {
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: updateSpy, isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
};

const milestone: MilestoneWithProgress = {
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
};

const secondMilestone: MilestoneWithProgress = {
  id: 'm2',
  project_id: 'p1',
  name: 'Procurement',
  sort_order: 1,
  target_date: null,
  weight: 1,
  input_pct: null,
  task_count: 0,
  calculated_pct: null,
  effective_pct: 0,
};

const milestoneState = {
  data: [milestone, secondMilestone] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => milestoneMutations,
}));

let mockRole = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: mockRole, effectiveRole: mockRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: mockRole }),
}));

import MilestoneStrip from '../MilestoneStrip';

const render$ = () =>
  render(
    <ToastProvider>
      <MilestoneStrip projectId="p1" />
    </ToastProvider>,
  );

const openEdit = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit progress for Engineering design' }));
  return screen.findByLabelText('Edit PM input %');
};

describe('MilestoneStrip inline input-% edit (AC-DEL-012)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSpy.mockResolvedValue(undefined);
    milestoneState.data = [milestone, secondMilestone];
    milestoneState.isPending = false;
    milestoneState.isError = false;
    mockRole = 'Project Manager';
  });

  it('AC-DEL-012: PM viewer — every phase exposes an "Edit progress" affordance and clicking one reveals the token input', async () => {
    render$();

    expect(screen.getAllByRole('button', { name: /Edit progress/i })).toHaveLength(2);
    const inputEl = await openEdit();
    expect(inputEl.className).toContain('h-8');
    expect(inputEl.className).toContain('rounded-md');
    expect(inputEl.className).toContain('border-input');
  });

  it('AC-DEL-012: Engineer viewer — no phase exposes an "Edit progress" affordance', () => {
    mockRole = 'Engineer';
    render$();
    expect(screen.queryByRole('button', { name: /Edit progress/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit PM input %')).not.toBeInTheDocument();
  });

  it('Saving calls update.mutateAsync with { input_pct }', async () => {
    render$();
    const inputEl = await openEdit();
    fireEvent.change(inputEl, { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ id: 'm1', patch: { input_pct: 80 } });
    });
  });

  it('Blanking the input field clears input_pct (sends null)', async () => {
    render$();
    const inputEl = await openEdit();
    fireEvent.change(inputEl, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ id: 'm1', patch: { input_pct: null } });
    });
  });

  it('entering a value > 100 shows an error and does NOT call the mutation', async () => {
    render$();
    const inputEl = await openEdit();
    fireEvent.change(inputEl, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/between 0 and 100/i)).toBeInTheDocument();
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('entering a value < 0 shows an error and does NOT call the mutation', async () => {
    render$();
    const inputEl = await openEdit();
    fireEvent.change(inputEl, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/between 0 and 100/i)).toBeInTheDocument();
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('pressing Enter commits the edit', async () => {
    render$();
    const inputEl = await openEdit();
    fireEvent.change(inputEl, { target: { value: '55' } });
    fireEvent.keyDown(inputEl, { key: 'Enter' });
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ id: 'm1', patch: { input_pct: 55 } });
    });
  });

  it('pressing Esc cancels the edit', async () => {
    render$();
    const inputEl = await openEdit();
    fireEvent.change(inputEl, { target: { value: '55' } });
    fireEvent.keyDown(inputEl, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Edit PM input %')).not.toBeInTheDocument();
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('blur commits the edit', async () => {
    render$();
    const inputEl = await openEdit();
    fireEvent.change(inputEl, { target: { value: '42' } });
    fireEvent.blur(inputEl);
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ id: 'm1', patch: { input_pct: 42 } });
    });
  });
});
