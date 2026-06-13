import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Force the desktop month grid for the event-placement assertions.
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));

import ProjectCalendarView from '../ProjectCalendarView';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { MilestoneDate } from '@/src/lib/db/milestones';

function project(over: Partial<ProjectWithRefs>): ProjectWithRefs {
  return {
    id: 'p1',
    name: 'Acme',
    code: 'ACM-1',
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

beforeEach(() => vi.clearAllMocks());

describe('ProjectCalendarView — event placement', () => {
  it('AC-CAL-002: project start/end events land in their day cells', () => {
    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Acme', start_date: '2026-06-03', end_date: '2026-06-20' })]}
        milestoneDates={[]}
        onOpenProject={() => {}}
        initialCursor={JUNE}
      />,
    );
    const day3 = screen.getByTestId('calendar-cell-2026-06-03');
    expect(within(day3).getByRole('button', { name: /Acme — start/ })).toBeInTheDocument();
    const day20 = screen.getByTestId('calendar-cell-2026-06-20');
    expect(within(day20).getByRole('button', { name: /Acme — end/ })).toBeInTheDocument();
  });

  it('AC-CAL-003: a milestone event labelled with its name lands in its day cell', () => {
    const milestones: MilestoneDate[] = [
      { id: 'm1', projectId: 'p1', name: 'Kickoff', targetDate: '2026-06-12' },
    ];
    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Acme' })]}
        milestoneDates={milestones}
        onOpenProject={() => {}}
        initialCursor={JUNE}
      />,
    );
    const day12 = screen.getByTestId('calendar-cell-2026-06-12');
    expect(within(day12).getByText(/Kickoff/)).toBeInTheDocument();
  });

  it('AC-CAL-004: activating a project event fires onOpenProject with the project id', async () => {
    const onOpenProject = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Acme', start_date: '2026-06-03' })]}
        milestoneDates={[]}
        onOpenProject={onOpenProject}
        initialCursor={JUNE}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Acme — start/ }));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('does not render a milestone event with a null/absent target_date (OBS-CAL-001)', () => {
    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Acme' })]}
        milestoneDates={[]}
        onOpenProject={() => {}}
        initialCursor={JUNE}
      />,
    );
    expect(screen.queryByText(/Kickoff/)).not.toBeInTheDocument();
  });
});
