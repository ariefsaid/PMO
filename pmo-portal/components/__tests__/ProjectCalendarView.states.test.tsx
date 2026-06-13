import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));

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

describe('ProjectCalendarView — empty state', () => {
  it('AC-CAL-006: shows "No events this month" while keeping the grid chrome', () => {
    render(
      <ProjectCalendarView
        // Events all fall outside June 2026.
        projects={[project({ id: 'p1', name: 'Acme', start_date: '2026-04-03', end_date: '2026-08-20' })]}
        milestoneDates={[]}
        onOpenProject={() => {}}
        initialCursor={{ year: 2026, month: 5 }}
      />,
    );
    expect(screen.getByText(/no events this month/i)).toBeInTheDocument();
    // Grid chrome (weekday header) is still present.
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-month-grid')).toBeInTheDocument();
  });
});
