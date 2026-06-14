import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Force desktop month grid for event chip assertions
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));

import ProjectCalendarView from '../ProjectCalendarView';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { MilestoneDate } from '@/src/lib/db/milestones';

function project(over: Partial<ProjectWithRefs> = {}): ProjectWithRefs {
  return {
    id: 'p1',
    name: 'Meridian HQ',
    code: 'MER-1',
    status: 'Ongoing Project',
    client_id: null,
    project_manager_id: null,
    start_date: null,
    end_date: null,
    contract_value: 0,
    budget: 0,
    spent: 0,
    customer_contract_ref: null,
    client: null,
    pm: null,
    ...over,
  } as ProjectWithRefs;
}

const JUNE = { year: 2026, month: 5 };

const milestones: MilestoneDate[] = [
  { id: 'm1', projectId: 'p1', name: 'KoM', targetDate: '2026-06-10' },
];

beforeEach(() => vi.clearAllMocks());

describe('ProjectCalendarView — AC-IFW-CAL-01: milestone chips are interactive buttons', () => {
  it('AC-IFW-CAL-01: milestone chip is a button (not a static span)', () => {
    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Meridian HQ' })]}
        milestoneDates={milestones}
        onOpenProject={() => {}}
        initialCursor={JUNE}
      />,
    );
    // The milestone chip must be an interactive button — not a static span
    const cell = screen.getByTestId('calendar-cell-2026-06-10');
    const chip = within(cell).getByRole('button', { name: /KoM/i });
    expect(chip).toBeInTheDocument();
  });

  it('AC-IFW-CAL-01: clicking a milestone chip calls onOpenProject with the project id (Lens-D regression invariant)', async () => {
    const onOpenProject = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Meridian HQ' })]}
        milestoneDates={milestones}
        onOpenProject={onOpenProject}
        initialCursor={JUNE}
      />,
    );

    const cell = screen.getByTestId('calendar-cell-2026-06-10');
    const chip = within(cell).getByRole('button', { name: /KoM/i });
    await user.click(chip);

    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('AC-IFW-CAL-01: every calendar chip (project AND milestone) is an interactive control', async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();

    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Meridian HQ', start_date: '2026-06-05' })]}
        milestoneDates={milestones}
        onOpenProject={onOpenProject}
        initialCursor={JUNE}
      />,
    );

    // Project start chip must be a button
    const startCell = screen.getByTestId('calendar-cell-2026-06-05');
    const startChip = within(startCell).getByRole('button', { name: /Meridian HQ — start/i });
    expect(startChip).toBeInTheDocument();

    // Milestone chip must also be a button (the regression invariant)
    const milestoneCell = screen.getByTestId('calendar-cell-2026-06-10');
    const milestoneChip = within(milestoneCell).getByRole('button', { name: /KoM/i });
    expect(milestoneChip).toBeInTheDocument();

    // Both navigate to the same project
    await user.click(milestoneChip);
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('AC-IFW-CAL-01: milestone chip has correct aria-label including project name', () => {
    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Meridian HQ' })]}
        milestoneDates={milestones}
        onOpenProject={() => {}}
        initialCursor={JUNE}
      />,
    );
    // The aria-label on the milestone chip includes both the milestone name and project context
    const cell = screen.getByTestId('calendar-cell-2026-06-10');
    const chip = within(cell).getByRole('button', { name: /KoM.*Meridian HQ/i });
    expect(chip).toBeInTheDocument();
  });
});
