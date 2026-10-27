import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Below md → agenda list, not the grid.
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => false }));

import ProjectCalendarView from '../ProjectCalendarView';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

function project(over: Partial<ProjectWithRefs>): ProjectWithRefs {
  return {
    id: 'p1',
    name: 'Acme',
    code: 'ACM-1',
    status: 'Ongoing Project',
    start_date: null,
    end_date: null,
    client: null,
    pm: null,
    ...over,
  } as ProjectWithRefs;
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectCalendarView — responsive agenda', () => {
  it('AC-CAL-007: below md renders the day-grouped agenda and not the 7-column grid', () => {
    render(
      <ProjectCalendarView
        projects={[project({ id: 'p1', name: 'Acme', start_date: '2026-06-03' })]}
        milestoneDates={[]}
        onOpenProject={() => {}}
        initialCursor={{ year: 2026, month: 5 }}
      />,
    );
    expect(screen.getByTestId('calendar-agenda')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-month-grid')).not.toBeInTheDocument();
    // The project event is still reachable as a button in the agenda.
    expect(screen.getByRole('button', { name: /Acme — start/ })).toBeInTheDocument();
  });
});
