import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Stubs ────────────────────────────────────────────────────────────────────

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

const milestoneState = {
  data: [milestone] as MilestoneWithProgress[],
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

describe('MilestoneStrip inline input-% edit (AC-DEL-012)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSpy.mockResolvedValue(undefined);
    milestoneState.data = [milestone];
    milestoneState.isPending = false;
    milestoneState.isError = false;
    mockRole = 'Project Manager';
  });

  it('AC-DEL-012: PM viewer — clicking the "PM input" cell reveals an editable number field', async () => {
    mockRole = 'Project Manager';
    render$();
    // The PM input cell is a button/clickable span for PM role
    const pmCell = screen.getByLabelText('PM input');
    // Find the editable span/button in the PM input cell
    const editableEl = pmCell.querySelector('[role="button"]') ?? pmCell;
    fireEvent.click(editableEl);
    // After click, an input should appear
    await waitFor(() => {
      expect(screen.getByLabelText('Edit PM input %')).toBeInTheDocument();
    });
  });

  it('AC-DEL-012: Engineer viewer — the "PM input" cell shows a static value, no editable field', () => {
    mockRole = 'Engineer';
    render$();
    const pmCell = screen.getByLabelText('PM input');
    // Should show static text "75%"
    expect(pmCell).toHaveTextContent('75%');
    // No input or role="button" affordance for Engineer
    expect(pmCell.querySelector('input')).toBeNull();
    expect(pmCell.querySelector('[role="button"]')).toBeNull();
  });

  it('Saving calls update.mutateAsync with { input_pct } and blanking sends { input_pct: null }', async () => {
    mockRole = 'Project Manager';
    render$();
    const pmCell = screen.getByLabelText('PM input');
    const editableEl = pmCell.querySelector('[role="button"]') ?? pmCell;
    fireEvent.click(editableEl);
    const inputEl = await screen.findByLabelText('Edit PM input %');
    fireEvent.change(inputEl, { target: { value: '80' } });
    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ id: 'm1', patch: { input_pct: 80 } });
    });
  });

  it('Blanking the input field clears input_pct (sends null)', async () => {
    mockRole = 'Project Manager';
    render$();
    const pmCell = screen.getByLabelText('PM input');
    const editableEl = pmCell.querySelector('[role="button"]') ?? pmCell;
    fireEvent.click(editableEl);
    const inputEl = await screen.findByLabelText('Edit PM input %');
    fireEvent.change(inputEl, { target: { value: '' } });
    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ id: 'm1', patch: { input_pct: null } });
    });
  });

  it('m4: entering a value > 100 shows an error and does NOT call the mutation', async () => {
    mockRole = 'Project Manager';
    render$();
    const pmCell = screen.getByLabelText('PM input');
    const editableEl = pmCell.querySelector('[role="button"]') ?? pmCell;
    fireEvent.click(editableEl);
    const inputEl = await screen.findByLabelText('Edit PM input %');
    fireEvent.change(inputEl, { target: { value: '101' } });
    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);
    // The error message should appear and the mutation must NOT be called
    await waitFor(() => {
      expect(screen.getByText(/between 0 and 100/i)).toBeInTheDocument();
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('m4: entering a value < 0 shows an error and does NOT call the mutation', async () => {
    mockRole = 'Project Manager';
    render$();
    const pmCell = screen.getByLabelText('PM input');
    const editableEl = pmCell.querySelector('[role="button"]') ?? pmCell;
    fireEvent.click(editableEl);
    const inputEl = await screen.findByLabelText('Edit PM input %');
    fireEvent.change(inputEl, { target: { value: '-5' } });
    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(screen.getByText(/between 0 and 100/i)).toBeInTheDocument();
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
