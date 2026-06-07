import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
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

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Timesheets />
      </ToastProvider>
    </MemoryRouter>,
  );

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
    // Only ONE row for 'Alpha Project' in the GRID — not two.
    // (The project name may also appear in the "By project this week" / "Recent entries" panels
    // so we scope the assertion to the table element itself.)
    const table = document.querySelector('table');
    const gridProjectCells = table ? Array.from(table.querySelectorAll('td')).filter(
      (td) => td.textContent?.includes('Alpha Project')
    ) : [];
    expect(gridProjectCells).toHaveLength(1);
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

  it("T1/AC-911 (UI): the weekly grid shows an enabled Submit button for the owner's own Draft sheet; clicking it opens a confirm and the submit mutation fires only on Confirm, then toasts (FR-TS-004)", async () => {
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

    // submit.mutate(vars, { onSuccess }) — invoke onSuccess so the toast runs.
    submitMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPage();

    const submitBtn = screen.getByRole('button', { name: /submit timesheet/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();

    await userEvent.click(submitBtn);
    // Owner rule: the first click must NOT submit.
    expect(submitMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Commit via the dialog's confirm button (scoped to the dialog).
    const { getByRole } = within(dialog);
    await userEvent.click(getByRole('button', { name: /^Submit timesheet$/i }));
    expect(submitMutate).toHaveBeenCalledWith(
      { id: 'ts-draft' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

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

// ── Phase 4: T11–T13 — Timesheet grid surround densification ────────────────

/** Helper: get the Monday of the current week in YYYY-MM-DD form (matches Timesheets page logic). */
function currentWeekStartStr(): string {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today);
  monday.setDate(diff);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

function currentWeekSheet() {
  const weekStr = currentWeekStartStr();
  const tue = new Date(weekStr + 'T00:00:00');
  tue.setDate(tue.getDate() + 1);
  const tueStr = `${tue.getFullYear()}-${String(tue.getMonth() + 1).padStart(2, '0')}-${String(tue.getDate()).padStart(2, '0')}`;
  return [{
    id: 'ts-cw', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
    submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
    entries: [
      { id: 'ec1', timesheet_id: 'ts-cw', project_id: 'pr1', entry_date: weekStr, hours: 6,
        notes: 'Planning session', project: { name: 'Alpha Project', code: 'A001' } },
      { id: 'ec2', timesheet_id: 'ts-cw', project_id: 'pr2', entry_date: tueStr, hours: 4,
        notes: null, project: { name: 'Beta Corp', code: null } },
    ],
  }];
}

describe('Timesheets T11: By-project-this-week panel from gridRows', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('T11: renders "By project this week" panel with one bar per distinct project', () => {
    tsState.data = currentWeekSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    const group = screen.getByRole('group', { name: /By project this week/i });
    expect(group).toBeInTheDocument();
    expect(group.querySelectorAll('[role="progressbar"]').length).toBeGreaterThanOrEqual(1);
  });

  it('T11: an empty week shows exactly one empty state, not separate panel empties', () => {
    tsState.data = [];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // Only the grid card's empty state renders
    expect(screen.getByTestId('timesheets-empty')).toBeInTheDocument();
    // The by-project panel must NOT render when gridRows is empty
    expect(screen.queryByRole('group', { name: /By project this week/i })).not.toBeInTheDocument();
  });
});

describe('Timesheets T13: Recent entries this week panel', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('T13: renders "Recent entries this week" panel with notes', () => {
    tsState.data = currentWeekSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    expect(screen.getByText(/Recent entries this week/i)).toBeInTheDocument();
  });

  it('T13: shows "No note" for null notes (not em-dash in entry rows)', () => {
    tsState.data = currentWeekSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // ec2 has notes=null → EntryList renders "No note" text
    expect(screen.getAllByText('No note').length).toBeGreaterThanOrEqual(1);
    // Confirm no em-dash placeholder within list items
    const listItems = document.querySelectorAll('li');
    const listText = Array.from(listItems).map((li) => li.textContent).join('');
    expect(listText).not.toContain('—');
  });
});
