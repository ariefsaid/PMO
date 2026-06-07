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

// ── timesheet-entry write path mocks (Tasks 14–20) ──────────────────────────
const saveWeekMutate = vi.fn();
const deleteRowMutate = vi.fn();
const entryMutations = {
  saveWeek: { mutate: saveWeekMutate, isPending: false },
  deleteRow: { mutate: deleteRowMutate, isPending: false },
};
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => entryMutations,
}));

const projectsState: { data: unknown[] | undefined } = { data: [] };
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
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

// ===========================================================================
// timesheet-entry: editable grid + state machine (Tasks 14–20)
// ===========================================================================

/** A Draft sheet owned by u-alice for the current week, with one project entry. */
function currentDraftSheet(status = 'Draft', entries?: unknown[]) {
  const weekStr = currentWeekStartStr();
  return [{
    id: 'ts-draft', user_id: 'u-alice', week_start_date: weekStr, status,
    submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
    entries: entries ?? [
      { id: 'ed1', timesheet_id: 'ts-draft', project_id: 'pP', entry_date: weekStr, hours: 8,
        notes: 'work', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
    ],
  }];
}

const ongoingProjects = [
  { id: 'pP', name: 'Innovate Corp HQ Fit-Out', code: 'P001', status: 'Ongoing Project', client: null, pm: null },
  { id: 'pQ', name: 'Acme Internal Platform', code: 'P003', status: 'Ongoing Project', client: null, pm: null },
  { id: 'pR', name: 'Lead Project', code: 'P099', status: 'Leads', client: null, pm: null },
];

describe('timesheet-entry: editable gating (Task 14)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveWeekMutate.mockClear();
    deleteRowMutate.mockClear();
    entryMutations.saveWeek.isPending = false;
    projectsState.data = ongoingProjects;
  });

  it('AC-TSE-001: a Draft sheet owned by the signed-in user renders the editable grid + Add project + Save', () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    // Editable cells are inputs (the Mon hour cell is an INPUT, not a DIV).
    expect(screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours').tagName).toBe('INPUT');
    expect(screen.getByLabelText(/add a project/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('AC-TSE-002: an empty week renders an editable empty grid with Add project and issues NO create write on mount', () => {
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    renderPage();
    // Add-project picker visible (the empty week is editable since sheet == null).
    expect(screen.getByLabelText(/add a project/i)).toBeInTheDocument();
    // No write on mount.
    expect(saveWeekMutate).not.toHaveBeenCalled();
  });

  it('AC-TSE-003: a Submitted sheet renders read-only (no inputs, no Add, no Save)', () => {
    tsState.data = currentDraftSheet('Submitted') as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    // The hour cell is a static DIV (read-only), not an editable INPUT.
    expect(screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours').tagName).toBe('DIV');
    expect(screen.queryByLabelText(/add a project/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('AC-TSE-004: an Approved sheet renders read-only', () => {
    tsState.data = currentDraftSheet('Approved') as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    expect(screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours').tagName).toBe('DIV');
    expect(screen.queryByLabelText(/add a project/i)).toBeNull();
  });
});

describe('timesheet-entry: project picker (Task 15)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveWeekMutate.mockClear();
    projectsState.data = ongoingProjects;
  });

  it("AC-TSE-006: the picker offers only Active projects not already a row (P present + R non-active excluded, Q offered)", async () => {
    // The Draft sheet already has project pP as a row.
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    const picker = screen.getByLabelText(/add a project/i) as HTMLSelectElement;
    const optionLabels = Array.from(picker.options)
      .map((o) => o.textContent)
      .filter((t) => t && !/select a project/i.test(t));
    expect(optionLabels).toEqual(['Acme Internal Platform']);
  });

  it('AC-TSE-005: selecting a project from the picker adds an empty editable row (0×7) and writes nothing', async () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    const picker = screen.getByLabelText(/add a project/i) as HTMLSelectElement;
    await userEvent.selectOptions(picker, 'pQ');
    // The added project's cells now exist as inputs.
    expect(screen.getByLabelText('Acme Internal Platform, Mon hours')).toBeInTheDocument();
    expect(saveWeekMutate).not.toHaveBeenCalled();
  });
});

describe('timesheet-entry: Save (Tasks 16–17)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveWeekMutate.mockClear();
    entryMutations.saveWeek.isPending = false;
    projectsState.data = ongoingProjects;
  });

  it('AC-TSE-016: Save on an empty week creates the Draft then upserts entries then toasts success', async () => {
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    saveWeekMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    renderPage();
    // Add a project, enter 8h Monday.
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '8');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(saveWeekMutate).toHaveBeenCalledTimes(1);
    const arg = saveWeekMutate.mock.calls[0][0];
    expect(arg.currentTimesheetId).toBeNull();
    expect(arg.weekStartDate).toBe(currentWeekStartStr());
    expect(arg.diff.upserts.some((u: { hours: number }) => u.hours === 8)).toBe(true);
    // Success toast.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));
  });

  it('AC-TSE-017: Save diffs an existing sheet to upsert changed cells and delete a zeroed cell', async () => {
    const weekStr = currentWeekStartStr();
    const wed = new Date(weekStr + 'T00:00:00'); wed.setDate(wed.getDate() + 2);
    const wedStr = `${wed.getFullYear()}-${String(wed.getMonth() + 1).padStart(2, '0')}-${String(wed.getDate()).padStart(2, '0')}`;
    tsState.data = currentDraftSheet('Draft', [
      { id: 'eMon', timesheet_id: 'ts-draft', project_id: 'pP', entry_date: weekStr, hours: 8,
        notes: null, project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      { id: 'eWed', timesheet_id: 'ts-draft', project_id: 'pP', entry_date: wedStr, hours: 2,
        notes: null, project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
    ]) as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    // Change Mon 8 → 6, add Tue 4, clear Wed.
    const mon = screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours');
    await userEvent.clear(mon); await userEvent.type(mon, '6');
    const tue = screen.getByLabelText('Innovate Corp HQ Fit-Out, Tue hours');
    await userEvent.type(tue, '4');
    const wedCell = screen.getByLabelText('Innovate Corp HQ Fit-Out, Wed hours');
    await userEvent.clear(wedCell);
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const diff = saveWeekMutate.mock.calls[0][0].diff;
    expect(diff.upserts.find((u: { entry_date: string; hours: number }) => u.entry_date === weekStr)?.hours).toBe(6);
    expect(diff.upserts.some((u: { hours: number }) => u.hours === 4)).toBe(true);
    expect(diff.deletes).toContain('eWed');
  });

  it('AC-TSE-009/010: Save is disabled while a cell is invalid (25) and enabled when all valid', async () => {
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '25');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    await userEvent.clear(mon); await userEvent.type(mon, '8');
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('AC-TSE-012: the header weekly total gates invalid cells to 0 (agrees with the grid footer, not a raw sum)', async () => {
    // Empty editable week; add a project, type a VALID 6h Mon + an INVALID 25 Tue.
    // The header must route through computeTotals (invalid→0): 6.0h, NOT 31.0h.
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '6');
    const tue = screen.getByLabelText('Acme Internal Platform, Tue hours');
    await userEvent.type(tue, '25');
    // Header total gates the invalid cell to 0 → 6.0; the grid footer agrees.
    expect(screen.getByTestId('timesheets-weekly-total')).toHaveTextContent('6.0');
    expect(screen.getByTestId('tsgrid-grand-total')).toHaveTextContent('6');
  });

  it('AC-TSE-011: blank/0/24 cells leave Save enabled', async () => {
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '24');
    const tue = screen.getByLabelText('Acme Internal Platform, Tue hours');
    await userEvent.type(tue, '0');
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('AC-TSE-018: a Save failure shows a failure toast carrying the error message and keeps the unsaved edits', async () => {
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    saveWeekMutate.mockImplementation(
      (_vars: unknown, opts?: { onError?: (e: Error) => void }) =>
        opts?.onError?.(Object.assign(new Error('rls denied'), { code: '42501' })),
    );
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '8');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/rls denied/i));
    // Edit retained — the cell still holds 8.
    expect((screen.getByLabelText('Acme Internal Platform, Mon hours') as HTMLInputElement).value).toBe('8');
  });
});

describe('timesheet-entry: delete row confirm (Task 18)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveWeekMutate.mockClear();
    deleteRowMutate.mockClear();
    projectsState.data = ongoingProjects;
  });

  it('AC-TSE-013: activating row delete opens a destructive ConfirmDialog and does not remove the row yet', async () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /delete .* row/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // Row still present.
    expect(screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours')).toBeInTheDocument();
    expect(deleteRowMutate).not.toHaveBeenCalled();
  });

  it('AC-TSE-014: confirming delete removes the row and deletes its persisted entries via deleteRow', async () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /delete .* row/i }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete row/i }));
    // Persisted row → deleteRow called with the server entry id(s).
    expect(deleteRowMutate).toHaveBeenCalled();
    const arg = deleteRowMutate.mock.calls[0][0];
    expect(arg.entryIds).toContain('ed1');
    // Row removed from the grid.
    expect(screen.queryByLabelText('Innovate Corp HQ Fit-Out, Mon hours')).toBeNull();
  });

  it('AC-TSE-015: cancelling delete keeps the row and issues no delete write', async () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /delete .* row/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancel/i }));
    expect(screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours')).toBeInTheDocument();
    expect(deleteRowMutate).not.toHaveBeenCalled();
  });

  it('AC-TSE-014: deleting an unsaved added row makes no DAL call (removed from edit state only)', async () => {
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    await userEvent.click(screen.getByRole('button', { name: /delete Acme Internal Platform row/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /delete row/i }));
    expect(deleteRowMutate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Acme Internal Platform, Mon hours')).toBeNull();
  });
});

describe('timesheet-entry: re-seed identity (Task 16 regression)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveWeekMutate.mockClear();
    deleteRowMutate.mockClear();
    entryMutations.saveWeek.isPending = false;
    projectsState.data = ongoingProjects;
  });

  it('AC-TSE-016 (regression): a same-week refetch does not clobber unsaved edit-state', async () => {
    // Mirrors the e2e step-8 clobber: on an empty editable Draft week the user re-adds a
    // project + types hours locally; a delete's invalidation refetch then lands with the
    // server entries now EMPTY (its content differs from the moment we seeded) for the SAME
    // sheet id / week / status. The unsaved local row must NOT be re-seeded away.
    const weekStr = currentWeekStartStr();
    // Before the refetch the server still has the old persisted row (pP). The user will
    // then add a DIFFERENT project locally; an async delete-invalidation refetch lands
    // with the server now EMPTY — content changed, so the buggy seedKey re-seeds.
    const sheetWith = (entries: unknown[]) => [{
      id: 'ts-draft', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries,
    }];
    tsState.data = sheetWith([
      { id: 'ed1', timesheet_id: 'ts-draft', project_id: 'pP', entry_date: weekStr, hours: 8,
        notes: 'work', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
    ]) as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;

    const { rerender } = renderPage();

    // ── Local edit: add a SECOND project row (pQ = Acme Internal Platform) and type hours.
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    await userEvent.type(screen.getByLabelText('Acme Internal Platform, Mon hours'), '5');
    expect((screen.getByLabelText('Acme Internal Platform, Mon hours') as HTMLInputElement).value).toBe('5');

    // ── A post-mutation invalidation refetch lands: useTimesheets returns a NEW array
    //    reference whose entry CONTENT differs (the old row is now gone server-side) for the
    //    SAME sheet id / week / status. This is exactly what a Save or Delete onSuccess
    //    invalidation produces — and the bug keyed re-seed on entry CONTENT, wiping the
    //    unsaved local row.
    tsState.data = sheetWith([]) as unknown as TimesheetWithEntries[];
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </MemoryRouter>,
    );

    // ── The unsaved local row + its typed hours MUST survive the refetch (not re-seeded away).
    expect(screen.getByLabelText('Acme Internal Platform, Mon hours')).toBeInTheDocument();
    expect((screen.getByLabelText('Acme Internal Platform, Mon hours') as HTMLInputElement).value).toBe('5');

    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
});

describe('timesheet-entry: loading + error parity (Task 19)', () => {
  beforeEach(() => { sessionStorage.clear(); projectsState.data = ongoingProjects; });

  it('AC-TSE-020: pending shows the loading skeleton; error shows the error+Retry state', () => {
    tsState.isPending = true; tsState.isError = false;
    const { unmount } = renderPage();
    expect(screen.getByTestId('timesheets-loading')).toBeInTheDocument();
    unmount();
    tsState.isPending = false; tsState.isError = true;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    tsState.isError = false;
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
});

describe('timesheet-entry: a11y (Task 20, NFR-TSE-A11Y-001)', () => {
  beforeEach(() => { sessionStorage.clear(); projectsState.data = ongoingProjects; });

  it('NFR-TSE-A11Y-001: editable cells are labelled "<project>, <weekday> hours"; the picker is labelled; the delete confirm is an alertdialog', async () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    expect(screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours').tagName).toBe('INPUT');
    expect(screen.getByLabelText(/add a project/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /delete .* row/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName();
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });
});
