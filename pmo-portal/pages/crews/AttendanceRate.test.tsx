import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CrewAttendanceRateRow } from '@/src/lib/db/attendanceRate';

/**
 * #2706 — the attendance-rate view (AC-ATR-008). The counting is the database's (pgTAP `attendance_rate.test.sql`);
 * this pins what a reviewer reads: the counts per crew, the rate against the target, the below-target mark, and the
 * dash — never 0 % — for a crew with no countable day.
 */
const h = vi.hoisted(() => ({
  canView: true,
  narrow: false,
  target: { data: 75 as number | null, isError: false } as { data: number | null; isError: boolean },
  report: {
    data: [] as CrewAttendanceRateRow[] | undefined, isPending: false, isError: false, isSuccess: true, refetch: vi.fn(),
  },
  args: [] as Array<[string | null, string | null]>,
}));

vi.mock('@/src/hooks/useAttendanceRate', () => ({
  useAttendanceTarget: () => h.target,
  useAttendanceRate: (from: string | null, to: string | null) => {
    h.args.push([from, to]);
    return h.report;
  },
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => entity === 'attendanceRate' && action === 'view' ? h.canView : false,
}));
vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => h.narrow }));

import AttendanceRate from './AttendanceRate';

const row = (over: Partial<CrewAttendanceRateRow>): CrewAttendanceRateRow => ({
  crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew one', expected_days: 15, present_days: 9, absent_days: 2,
  leave_days: 1, off_rotation_days: 1, no_record_days: 2, countable_days: 13, rate: 69.23, target_rate: 75,
  meets_target: false, ...over,
});

beforeEach(() => {
  h.canView = true;
  h.narrow = false;
  h.target = { data: 75, isError: false };
  h.args = [];
  h.report = { data: [], isPending: false, isError: false, isSuccess: true, refetch: vi.fn() };
});

describe('attendance rate against the target (#2706)', () => {
  it('AC-ATR-008 lists each crew\'s counts and rate, and marks only the crews under the target', () => {
    h.report.data = [
      row({}),
      row({ crew_id: 'c2', crew_code: 'CR-2', crew_name: 'Crew two', expected_days: 3, present_days: 3, absent_days: 0,
        leave_days: 0, off_rotation_days: 0, no_record_days: 0, countable_days: 3, rate: 100, meets_target: true }),
      row({ crew_id: 'c3', crew_code: 'CR-3', crew_name: 'Crew three', expected_days: 0, present_days: 0, absent_days: 0,
        leave_days: 0, off_rotation_days: 0, no_record_days: 0, countable_days: 0, rate: null, meets_target: null }),
    ];
    render(<AttendanceRate />);

    const under = screen.getByRole('row', { name: /CR-1/ });
    expect(under).toHaveTextContent('15');
    expect(under).toHaveTextContent('69.23%');
    expect(under).toHaveTextContent('75%');
    expect(screen.getAllByText('Below target')).toHaveLength(1);

    const over = screen.getByRole('row', { name: /CR-2/ });
    expect(over).toHaveTextContent('100%');
    expect(over).not.toHaveTextContent('Below target');

    // A crew with no countable day reads a dash, never 0 %.
    const blank = screen.getByRole('row', { name: /CR-3/ });
    expect(blank).toHaveTextContent('—');
    expect(blank).not.toHaveTextContent('Below target');
  });

  it('asks for the current month up to today by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 21));
    try {
      render(<AttendanceRate />);
      expect(h.args).toContainEqual(['2026-11-01', '2026-11-21']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when no crew has attendance in the period, instead of an empty table', () => {
    render(<AttendanceRate />);
    expect(screen.getByText('No crew has attendance in this period.')).toBeInTheDocument();
  });

  it('offers the report on a phone as one card per crew', () => {
    h.narrow = true;
    h.report.data = [row({})];
    render(<AttendanceRate />);
    expect(screen.getByText(/Crew one/)).toBeInTheDocument();
    expect(screen.getByText('Attendance rate')).toBeInTheDocument();
    expect(screen.getAllByText('Below target')).toHaveLength(1);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers nothing to a role that does not read the whole organisation\'s attendance', () => {
    h.canView = false;
    render(<AttendanceRate />);
    expect(screen.queryByText('Attendance rate')).toBeNull();
    // The guard runs before any period is requested: the view asks for nothing.
    expect(h.args).toEqual([[null, null]]);
  });

  it('shows the error with a retry when the read is refused or fails', () => {
    h.report = { ...h.report, data: undefined, isPending: false, isError: true, isSuccess: false };
    render(<AttendanceRate />);
    expect(screen.getByText("Couldn't load the attendance rate")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
