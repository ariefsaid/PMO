import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import MilestoneFormModal from '../MilestoneFormModal';

const fractionalPhase: MilestoneWithProgress = {
  id: 'phase-1',
  project_id: 'project-1',
  name: 'Engineering design',
  sort_order: 1,
  target_date: '2026-11-12',
  weight: 2,
  input_pct: 33.33,
  task_count: 3,
  calculated_pct: 30,
  effective_pct: 33.33,
};

describe('MilestoneFormModal fractional progress preservation (PGB-009)', () => {
  it('preserves fractional input_pct in the input field without Math.round', () => {
    render(
      <ToastProvider>
        <MilestoneFormModal
          milestone={fractionalPhase}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onError={vi.fn()}
        />
      </ToastProvider>,
    );

    const progressInput = screen.getByRole('spinbutton', { name: /progress override/i }) as HTMLInputElement;
    expect(progressInput.value).toBe('33.33');
  });

  it('unrelated edit (changing name) does NOT submit rounded or unchanged input_pct', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <MilestoneFormModal
          milestone={fractionalPhase}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onUpdate={onUpdate}
          onError={vi.fn()}
        />
      </ToastProvider>,
    );

    const nameInput = screen.getByRole('textbox', { name: /phase name/i });
    fireEvent.change(nameInput, { target: { value: 'Engineering design v2' } });

    const submitBtn = screen.getByRole('button', { name: /save phase/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    // Patch must only contain changed fields, without overwriting input_pct
    expect(onUpdate).toHaveBeenCalledWith('phase-1', {
      name: 'Engineering design v2',
    });
  });

  it('explicitly editing input_pct to another fractional value submits the exact fractional number', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <MilestoneFormModal
          milestone={fractionalPhase}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onUpdate={onUpdate}
          onError={vi.fn()}
        />
      </ToastProvider>,
    );

    const progressInput = screen.getByRole('spinbutton', { name: /progress override/i });
    fireEvent.change(progressInput, { target: { value: '45.75' } });

    const submitBtn = screen.getByRole('button', { name: /save phase/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    expect(onUpdate).toHaveBeenCalledWith('phase-1', {
      input_pct: 45.75,
    });
  });
});
