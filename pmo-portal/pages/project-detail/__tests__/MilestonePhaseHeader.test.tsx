import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MilestonePhaseHeader } from '@/src/components/milestones/MilestonePhaseHeader';

describe('MilestonePhaseHeader', () => {
  it('AC-DEL-008 AC-DEL-009 AC-DEL-012: stepper variant renders name+Current on same line, effective % in right column, weight share, target, no From tasks', async () => {
    const onEditProgress = vi.fn();
    render(
      <MilestonePhaseHeader
        variant="stepper"
        name="Engineering"
        targetDate="2026-08-15"
        effectivePct={75}
        calculatedPct={60}
        weight={30}
        totalWeight={200}
        isCurrent
        isOverdue
        canEditProgress
        onEditProgress={onEditProgress}
      />,
    );

    // Name is present
    expect(screen.getByText('Engineering')).toBeInTheDocument();

    // Effective % is present (in right column)
    expect(screen.getByText('75%')).toBeInTheDocument();

    // Weight share: 30/200 * 100 = 15%
    expect(screen.getByText('15% of project')).toBeInTheDocument();

    // Target date
    const target = screen.getByText('Target 15 Aug');
    expect(target).toBeInTheDocument();
    expect(target.className).toContain('text-warning-foreground');

    // Current label exists
    expect(screen.getByText('Current')).toBeInTheDocument();

    // Overdue pill exists
    expect(screen.getByText('Overdue')).toBeInTheDocument();

    // NO "From tasks" text (removed from desktop cards)
    expect(screen.queryByText(/From tasks/i)).not.toBeInTheDocument();

    // Edit progress button works
    await userEvent.click(screen.getByRole('button', { name: 'Edit progress for Engineering' }));
    expect(onEditProgress).toHaveBeenCalledTimes(1);
  });

  it('stepper variant: name and Current/Overdue labels are on the same row', () => {
    render(
      <MilestonePhaseHeader
        variant="stepper"
        name="Engineering"
        targetDate="2026-08-15"
        effectivePct={75}
        calculatedPct={60}
        weight={30}
        totalWeight={200}
        isCurrent
        isOverdue={false}
        canEditProgress={false}
      />,
    );

    // The name and Current should be in the same flex row
    const nameEl = screen.getByText('Engineering');
    const currentEl = screen.getByText('Current');
    // They should share a common flex parent
    const nameRow = nameEl.closest('div');
    expect(nameRow).toContainElement(currentEl);
  });

  it('stepper variant: effective percentage is in a right column (flex justify-between)', () => {
    const { container } = render(
      <MilestonePhaseHeader
        variant="stepper"
        name="Engineering"
        targetDate="2026-08-15"
        effectivePct={75}
        calculatedPct={60}
        weight={30}
        totalWeight={200}
      />,
    );

    // The outer row should use justify-between to put name left and % right
    const outerRow = container.querySelector('.flex.justify-between');
    expect(outerRow).toBeInTheDocument();
    // The right column should contain the effective %
    expect(outerRow!).toContainElement(screen.getByText('75%'));
  });

  it('stepper variant: weight share rounds to whole percent', () => {
    render(
      <MilestonePhaseHeader
        variant="stepper"
        name="Procurement"
        targetDate={null}
        effectivePct={0}
        calculatedPct={null}
        weight={1}
        totalWeight={3}
      />,
    );

    // 1/3 * 100 = 33.33... → rounds to 33%
    expect(screen.getByText('33% of project')).toBeInTheDocument();
  });

  it('stepper variant: no weight share when totalWeight is 0', () => {
    render(
      <MilestonePhaseHeader
        variant="stepper"
        name="Procurement"
        targetDate={null}
        effectivePct={0}
        calculatedPct={null}
        weight={1}
        totalWeight={0}
      />,
    );

    // Should not render weight share when totalWeight is 0
    expect(screen.queryByText(/of project/)).not.toBeInTheDocument();
  });

  it('stepper variant without overdue: no overdue pill, target is muted', () => {
    render(
      <MilestonePhaseHeader
        variant="stepper"
        name="Engineering"
        targetDate="2026-08-15"
        effectivePct={75}
        calculatedPct={60}
        weight={1}
        totalWeight={1}
        isCurrent
        isOverdue={false}
        canEditProgress
        onEditProgress={vi.fn()}
      />,
    );

    const target = screen.getByText('Target 15 Aug');
    expect(target.className).not.toContain('text-warning-foreground');
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('AC-DEL-010: compact variant renders only name + target (no regression)', () => {
    render(
      <MilestonePhaseHeader
        variant="compact"
        name="Procurement"
        targetDate="2026-08-15"
        effectivePct={40}
        calculatedPct={25}
        weight={1}
        totalWeight={4}
      />,
    );

    expect(screen.getByText('Procurement')).toBeInTheDocument();
    expect(screen.getByText('Target 15 Aug')).toBeInTheDocument();
    // Compact should NOT show percentage
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
    // Compact should NOT show weight share
    expect(screen.queryByText(/of project/)).not.toBeInTheDocument();
    // Compact should NOT show edit button
    expect(screen.queryByRole('button', { name: /Edit progress/i })).not.toBeInTheDocument();
    // Compact should NOT show From tasks
    expect(screen.queryByText(/From tasks/i)).not.toBeInTheDocument();
  });
});
