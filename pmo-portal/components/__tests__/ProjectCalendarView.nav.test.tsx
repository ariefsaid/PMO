import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));

import ProjectCalendarView from '../ProjectCalendarView';
import { monthLabel, todayCursor } from '@/src/lib/calendar/monthMatrix';

beforeEach(() => vi.clearAllMocks());

describe('ProjectCalendarView — month navigation', () => {
  it('#1126 the today ring marks the organisation\'s day, not the browser\'s', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-11-30T18:00:00Z: the organisation's day (Asia/Jakarta) is already 1 Dec; the browser's (UTC) is still 30 Nov.
    vi.setSystemTime(new Date('2026-11-30T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    try {
      render(
        <ProjectCalendarView
          projects={[]}
          milestoneDates={[]}
          onOpenProject={() => {}}
          initialCursor={{ year: 2026, month: 11 }}
        />,
      );
      expect(screen.getByTestId('calendar-cell-2026-12-01')).toHaveClass('ring-1');
      expect(screen.getByTestId('calendar-cell-2026-11-30')).not.toHaveClass('ring-1');
    } finally {
      resetActiveLocale();
      vi.useRealTimers();
    }
  });

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
