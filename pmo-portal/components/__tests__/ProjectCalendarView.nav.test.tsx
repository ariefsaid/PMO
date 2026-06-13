import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));

import ProjectCalendarView from '../ProjectCalendarView';
import { monthLabel, todayCursor } from '@/src/lib/calendar/monthMatrix';

beforeEach(() => vi.clearAllMocks());

describe('ProjectCalendarView — month navigation', () => {
  it('AC-CAL-005: Next, Prev, Today move the displayed month', async () => {
    const user = userEvent.setup();
    render(
      <ProjectCalendarView
        projects={[]}
        milestoneDates={[]}
        onOpenProject={() => {}}
        initialCursor={{ year: 2026, month: 5 }}
      />,
    );
    expect(screen.getByText('June 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByText('July 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /previous month/i }));
    expect(screen.getByText('June 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /today/i }));
    const t = todayCursor();
    expect(screen.getByText(monthLabel(t.year, t.month))).toBeInTheDocument();
  });
});
