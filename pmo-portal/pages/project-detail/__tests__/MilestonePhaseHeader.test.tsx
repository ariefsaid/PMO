import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MilestonePhaseHeader } from '@/src/components/milestones/MilestonePhaseHeader';

describe('MilestonePhaseHeader', () => {
  it('AC-DEL-008 AC-DEL-009 AC-DEL-012: stepper variant renders milestone status, affordances, and overdue treatment', async () => {
    const onEditProgress = vi.fn();
    render(
      <MilestonePhaseHeader
        variant="stepper"
        name="Engineering"
        targetDate="2026-08-15"
        effectivePct={75}
        calculatedPct={60}
        isCurrent
        isOverdue
        canEditProgress
        onEditProgress={onEditProgress}
      />,
    );

    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    const target = screen.getByText('Target 15 Aug');
    expect(target).toBeInTheDocument();
    expect(target.className).toContain('text-destructive');
    expect(screen.getByText('From tasks 60%')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit progress' }));
    expect(onEditProgress).toHaveBeenCalledTimes(1);
  });

  it('AC-DEL-010: compact variant renders only name + target', () => {
    render(
      <MilestonePhaseHeader
        variant="compact"
        name="Procurement"
        targetDate="2026-08-15"
        effectivePct={40}
        calculatedPct={25}
      />,
    );

    expect(screen.getByText('Procurement')).toBeInTheDocument();
    expect(screen.getByText('Target 15 Aug')).toBeInTheDocument();
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit progress' })).not.toBeInTheDocument();
  });
});
