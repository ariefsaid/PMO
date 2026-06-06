import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const submitMutate = vi.fn();

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
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: submitMutate, isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
}));

const renderPage = () => render(<MemoryRouter><Timesheets /></MemoryRouter>);

beforeEach(() => {
  sessionStorage.clear(); // reset the persisted view so each test starts on the grid
});

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

describe('Timesheets view toggle (Grid default + Approvals queue)', () => {
  it('defaults to the weekly grid and offers an Approvals queue toggle', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    expect(screen.getByRole('tab', { name: /weekly grid/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /approvals queue/i })).toBeInTheDocument();
    // Grid body renders the joined project name (one row per project+notes).
    expect(screen.getAllByText('Innovate Corp HQ Fit-Out').length).toBeGreaterThan(0);
  });

  it('switching to the Approvals queue shows the SoD GateNotice (edge: self-approval blocked)', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /approvals queue/i }));
    expect(screen.getByText(/Separation of duties/i)).toBeInTheDocument();
    // Empty queue → "Nothing awaiting you" (AC-604-style finance/manager empty queue).
    expect(screen.getByTestId('approvals-empty')).toBeInTheDocument();
  });
});

describe('Timesheets returned-for-changes edge state', () => {
  it('renders the returned-week ErrBanner (role=status) when the week is Rejected', () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    const weekStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

    const rejectedSheet = [{
      id: 'ts-rej', user_id: 'u-alice', week_start_date: weekStr, status: 'Rejected',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [
        { id: 'er', timesheet_id: 'ts-rej', project_id: 'pr1', entry_date: weekStr, hours: 8,
          notes: 'Work', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
    }];
    tsState.data = rejectedSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent(/returned for changes/i);
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
});

// ---------------------------------------------------------------------------
// #4 — Zero badge hidden in ViewToggle
// ---------------------------------------------------------------------------

describe('Timesheets #4: ViewToggle count badge', () => {
  it('#4: the Approvals queue tab has no visible badge when pendingCount === 0', () => {
    // useTimesheetsAwaitingApproval returns [] (empty) by default in this file's mock
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // The Badge inside the approvals tab should NOT render "0"
    const approvalsTab = screen.getByRole('tab', { name: /approvals queue/i });
    // No "0" text should appear inside the tab
    expect(approvalsTab.textContent).not.toContain('0');
  });
});

// ---------------------------------------------------------------------------
// #5 — gridRows grouped by project only (not project+notes)
// ---------------------------------------------------------------------------

describe('Timesheets #5: grid rows grouped by project only', () => {
  it('#5: two entries for the same project but different notes produce ONE grid row', () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    const weekStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    const tue = new Date(monday);
    tue.setDate(monday.getDate() + 1);
    const tueStr = `${tue.getFullYear()}-${String(tue.getMonth() + 1).padStart(2, '0')}-${String(tue.getDate()).padStart(2, '0')}`;

    const twoNoteSheet = [{
      id: 'ts-twonote', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [
        { id: 'en1', timesheet_id: 'ts-twonote', project_id: 'pr1', entry_date: weekStr, hours: 3,
          notes: 'Meeting', project: { name: 'Alpha Project', code: 'A001' } },
        { id: 'en2', timesheet_id: 'ts-twonote', project_id: 'pr1', entry_date: tueStr, hours: 5,
          notes: 'Development', project: { name: 'Alpha Project', code: 'A001' } },
      ],
    }];
    tsState.data = twoNoteSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // Only ONE row for 'Alpha Project' — not two
    const projectCells = screen.getAllByText('Alpha Project');
    expect(projectCells).toHaveLength(1);
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
});

// ---------------------------------------------------------------------------
// C5 — Submit button wiring (AC-911 UI, FR-TS-004)
// ---------------------------------------------------------------------------

describe('Timesheets submit button', () => {
  beforeEach(() => {
    submitMutate.mockClear();
  });

  it("AC-911 (UI): the weekly grid shows an enabled Submit button for the owner's own Draft sheet and calls the submit mutation (FR-TS-004)", () => {
    // pmSheet has user_id 'u-alice' and useAuth returns id 'u-alice' → isOwner=true
    // week_start_date must match the current week; Timesheets page uses today's week
    // so we set a Draft sheet matching the current week string
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    const weekStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

    const draftSheet = [{
      id: 'ts-draft', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [],
    }];
    tsState.data = draftSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;

    renderPage();

    const submitBtn = screen.getByRole('button', { name: /submit timesheet/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(submitMutate).toHaveBeenCalledWith({ id: 'ts-draft' });

    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });

  it('AC-911 (UI): no Submit button on a Submitted sheet (badge shown instead) (FR-TS-004)', () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    const weekStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

    const submittedSheet = [{
      id: 'ts-sub', user_id: 'u-alice', week_start_date: weekStr, status: 'Submitted',
      submitted_at: '2026-06-08T17:00:00Z', approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [],
    }];
    tsState.data = submittedSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;

    renderPage();

    // Submit button should NOT be present for Submitted status
    expect(screen.queryByRole('button', { name: /submit timesheet/i })).toBeNull();

    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
});
