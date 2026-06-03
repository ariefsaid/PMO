import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import Timesheets from './Timesheets';

// Seeded PM week (2026-06-01): 6 + 4 = 10.0 hours, one project.
const pmSheet = [{
  id: 'ts-pm', user_id: 'u-alice', week_start_date: '2026-06-01', status: 'Draft',
  submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
  entries: [
    { id: 'e1', timesheet_id: 'ts-pm', project_id: 'pr1', entry_date: '2026-06-01', hours: 6,
      notes: 'Client workshop', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
    { id: 'e2', timesheet_id: 'ts-pm', project_id: 'pr1', entry_date: '2026-06-02', hours: 4,
      notes: 'Status report', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
  ],
}];

const tsState: {
  data: TimesheetWithEntries[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: pmSheet as unknown as TimesheetWithEntries[], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const renderPage = () => render(<MemoryRouter><Timesheets /></MemoryRouter>);

describe('Timesheets (real data)', () => {
  it('renders the signed-in user entry with joined project name for the current week (AC-601)', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    expect(screen.getAllByText('Innovate Corp HQ Fit-Out').length).toBeGreaterThan(0);
  });

  it('renders the correct memoized weekly total 10.0 (AC-602, AC-607)', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // weekly-total cell renders toFixed(1); a rendered computed value, not mere presence.
    expect(screen.getByTestId('timesheets-weekly-total')).toHaveTextContent('10.0');
  });
});

describe('Timesheets states', () => {
  it('loading skeleton while pending (AC-605)', () => {
    tsState.isPending = true; tsState.isError = false;
    renderPage();
    expect(screen.getByTestId('timesheets-loading')).toBeInTheDocument();
    tsState.isPending = false;
  });

  it('shows empty-week state when data exists but for a different week (AC-604)', () => {
    // Sheet exists for week of 2026-05-25 — does NOT match the current week (2026-06-01).
    // currentWeekEntries.length === 0 while sheets non-empty → empty state must render.
    const otherWeekSheet = [{
      id: 'ts-other', user_id: 'u-alice', week_start_date: '2026-05-25', status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [
        { id: 'e9', timesheet_id: 'ts-other', project_id: 'pr1', entry_date: '2026-05-25', hours: 8,
          notes: 'Planning', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
    }];
    tsState.data = otherWeekSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    expect(screen.getByTestId('timesheets-empty')).toBeInTheDocument();
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
  it('error state with retry (AC-606)', () => {
    tsState.isError = true; tsState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    tsState.isError = false;
  });
  it('empty state when the current week has no entries (AC-604)', () => {
    tsState.data = [];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    expect(screen.getByTestId('timesheets-empty')).toBeInTheDocument();
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
});
