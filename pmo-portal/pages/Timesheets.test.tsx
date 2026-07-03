import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import Timesheets from './Timesheets';

// ── Clock-pin (date-drift fix) ───────────────────────────────────────────────
// The Timesheets page computes "the current week" from `new Date()`. The fixtures
// below pin a fixed week (2026-06-01 Monday) as the current week, so the component's
// derived current week deterministically matches the mocked/seeded data on ANY real
// date. Pin the clock to Wed 2026-06-03 12:00 (inside that week). `shouldAdvanceTime`
// keeps user-event's internal timers (delays) live so async interactions still resolve.
const PINNED_NOW = new Date('2026-06-03T12:00:00');
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// Seeded PM week (2026-06-01, the pinned current week): 6 + 4 = 10.0 hours, one project.
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
const { awaitingState } = vi.hoisted(() => ({
  awaitingState: { data: [] as unknown[] },
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: submitMutate, isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: awaitingState.data, isPending: false, isError: false }),
}));

// ── timesheet-entry write path mocks (Tasks 14–20 + O1) ─────────────────────
const saveWeekMutate = vi.fn();
// AC-W3-O1: mutateAsync is the chained path (auto-save-then-submit). Default returns a
// resolved Promise<string> (the sheet id) so the auto-save→submit chain can proceed.
const saveWeekMutateAsync = vi.fn().mockResolvedValue('ts-auto');
const deleteRowMutate = vi.fn();
const entryMutations = {
  saveWeek: { mutate: saveWeekMutate, mutateAsync: saveWeekMutateAsync, isPending: false },
  deleteRow: { mutate: deleteRowMutate, isPending: false },
};
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => entryMutations,
}));

const projectsState: { data: unknown[] | undefined } = { data: [] };
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
}));

// These journeys are a PM entering / viewing their own week + the approvals queue; render
// under a PM real role so the A-6 timesheet-entry gate (Admin·Exec·PM·Engineer) keeps the grid
// editable and the A-2 approver gate keeps the queue actionable.
const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  sessionStorage.clear(); // reset the persisted view so each test starts on the grid
  saveWeekMutateAsync.mockResolvedValue('ts-auto'); // reset to default resolved value
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

describe('CW-6: Timesheets no longer hosts its own approvals queue', () => {
  it('CW-6: there is NO in-page "Approvals queue" tab (the queue moved to /approvals)', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // The weekly grid renders directly; no view-toggle tabs at all.
    expect(screen.queryByRole('tab', { name: /approvals queue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /weekly grid/i })).not.toBeInTheDocument();
    // Grid body renders the joined project name (one row per project+notes).
    expect(screen.getAllByText('Innovate Corp HQ Fit-Out').length).toBeGreaterThan(0);
  });

  it('CW-6: an approver gets a cross-link routing to /approvals?scope=timesheets (single canonical home)', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    const link = screen.getByRole('link', { name: /approvals/i });
    expect(link).toHaveAttribute('href', '/approvals?scope=timesheets');
  });

  it('CW-6: the cross-link shows "Review N awaiting" when sheets are pending (fix #8)', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    awaitingState.data = [{ id: 'a1' }, { id: 'a2' }] as unknown[];
    renderPage();
    // fix #8: with pending count > 0, copy changes to "Review N awaiting" (more prominent CTA).
    const link = screen.getByRole('link', { name: /review 2 awaiting/i });
    expect(link.textContent).toContain('2');
    awaitingState.data = [];
  });

  it('CW-6: the in-page SoD queue body is gone (no ApprovalsQueue rendered on Timesheets)', () => {
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // The queue's unique surfaces (SoD GateNotice / empty body) no longer live here.
    expect(screen.queryByText(/Separation of duties/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('approvals-queue')).not.toBeInTheDocument();
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

describe('CW-6: Timesheets approvals cross-link badge', () => {
  it('CW-6: the approvals cross-link reads "Approvals" (no count) when nothing is pending', () => {
    // useTimesheetsAwaitingApproval returns [] (empty) by default in this file's mock
    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
    tsState.isPending = false;
    tsState.isError = false;
    renderPage();
    // fix #8: zero-pending shows plain "Approvals" (no count in the text).
    const link = screen.getByRole('link', { name: /^Approvals$/i });
    expect(link.textContent).not.toContain('0');
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

  it("T1/AC-911 (UI): the footer shows an enabled Submit for the owner's own Draft sheet with persisted hours; clicking it opens a confirm and the submit mutation fires only on Confirm, then toasts (FR-TS-004, AC-IXD-TS-002)", async () => {
    // pmSheet has user_id 'u-alice' and useAuth returns id 'u-alice' → isOwner=true
    // week_start_date must match the current week; Timesheets page uses today's week
    // so we set a Draft sheet matching the current week string. Submit now lives in the
    // footer and is enabled only once the Draft has at least one PERSISTED entry (AC-IXD-TS-002).
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    const weekStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

    const draftSheet = [{
      id: 'ts-draft', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [
        { id: 'ed1', timesheet_id: 'ts-draft', project_id: 'pr1', entry_date: weekStr, hours: 8,
          notes: null, project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
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

// AC-IXD-TS-004 (plan task 16): the "By project this week" + "Recent entries this week" rollup
// panels are REMOVED from the entry surface (the grid totals are the single source of truth; the
// rollups live on the Engineer dashboard only). The deliberate-removal is asserted in
// pages/__tests__/Timesheets.footer.test.tsx (AC-IXD-TS-004); the obsolete T11/T13 "panel renders"
// tests are retired with the panels they covered.

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
    const addProject = screen.getByLabelText(/add a project/i);
    expect(addProject).toBeInTheDocument();
    expect(addProject).toHaveClass('h-8');
    expect(document.querySelector('label[for="ts-add-project"]')).toHaveClass('sr-only');
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

// ---------------------------------------------------------------------------
// AC-W3-F5 — Delete row is resilient: row restored on server failure
// ---------------------------------------------------------------------------

describe('AC-W3-F5: timesheet row delete restores row on server failure', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveWeekMutate.mockClear();
    deleteRowMutate.mockClear();
    entryMutations.saveWeek.isPending = false;
    projectsState.data = ongoingProjects;
  });

  it('AC-W3-F5: failed delete keeps the row in the grid and shows a warning toast', async () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;

    // Mock deleteRow to invoke onError
    deleteRowMutate.mockImplementation(
      (_vars: unknown, opts?: { onError?: (e: Error) => void }) =>
        opts?.onError?.(new Error('delete failed on server')),
    );

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /delete .* row/i }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete row/i }));

    // Row must STILL be in the grid (rollback on failure).
    expect(screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours')).toBeInTheDocument();

    // A warning toast must have appeared.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
  });

  it('AC-W3-F5: successful delete removes the row from the grid', async () => {
    tsState.data = currentDraftSheet() as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;

    // Mock deleteRow to invoke onSuccess
    deleteRowMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /delete .* row/i }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete row/i }));

    // Row must be gone from the grid.
    expect(screen.queryByLabelText('Innovate Corp HQ Fit-Out, Mon hours')).toBeNull();

    tsState.data = pmSheet as unknown as TimesheetWithEntries[];
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
      <ImpersonationProvider realRole="Project Manager">
        <MemoryRouter>
          <ToastProvider>
            <Timesheets />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>,
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

// ---------------------------------------------------------------------------
// AC-W3-O1 — Submit auto-saves valid dirty rows first (OD-W3-1)
// ---------------------------------------------------------------------------
/**
 * AC-W3-O1: Submit should be enabled when the edit buffer has valid hours (even before
 * a Save), and on confirm should auto-save dirty rows before submitting.
 *
 * OD-W3-1 decision: keep both Save + Submit co-located, but Submit auto-saves any valid
 * dirty rows first and then submits — one action (plus the confirm). This eliminates the
 * 3-step Save→Submit→Confirm for a fresh week.
 *
 * Invariants preserved: confirm dialog still fires first (consequential), no-op save
 * suppression, the seedKey re-seed-race guard, and the RPC contracts (saveWeek diff,
 * submit_timesheet {id}).
 */
describe('AC-W3-O1: Submit auto-saves valid dirty rows first, then submits', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveWeekMutate.mockClear();
    saveWeekMutateAsync.mockClear();
    saveWeekMutateAsync.mockResolvedValue('ts-auto');
    submitMutate.mockClear();
    entryMutations.saveWeek.isPending = false;
    projectsState.data = ongoingProjects;
  });

  it('AC-W3-O1: Submit is ENABLED when the edit buffer has valid hours even with no persisted entries yet', async () => {
    // No sheet at all — fresh week. User types 8h Monday but hasn't saved.
    tsState.data = [];
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    // Add a project and type hours.
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '8');

    const footer = screen.getByTestId('timesheets-footer');
    const submitBtn = within(footer).getByRole('button', { name: /submit timesheet/i });
    // OD-W3-1: Submit must be ENABLED (buffer has valid hours).
    expect(submitBtn).toBeEnabled();
  });

  it('AC-W3-O1: Submit is DISABLED when the edit buffer has no hours (empty week)', () => {
    // Empty week, no hours typed — nothing to submit.
    tsState.data = [];
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    const footer = screen.getByTestId('timesheets-footer');
    expect(within(footer).getByRole('button', { name: /submit timesheet/i })).toBeDisabled();
  });

  it('AC-W3-O1: Submit is DISABLED when the edit buffer has only invalid hours (e.g. 25)', async () => {
    tsState.data = [];
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '25');

    const footer = screen.getByTestId('timesheets-footer');
    expect(within(footer).getByRole('button', { name: /submit timesheet/i })).toBeDisabled();
  });

  it('AC-W3-O1: on a fresh (no-prior-Save) week, Submit+confirm calls saveWeek THEN submit (in order)', async () => {
    // No sheet — brand-new week. User types valid hours and hits Submit.
    tsState.data = [];
    tsState.isPending = false; tsState.isError = false;

    // saveWeekMutateAsync resolves with the new sheet id 'ts-new'.
    saveWeekMutateAsync.mockResolvedValue('ts-new');
    // submit.mutate invokes onSuccess so the confirm closes + toast fires.
    submitMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPage();

    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    const mon = screen.getByLabelText('Acme Internal Platform, Mon hours');
    await userEvent.type(mon, '8');

    const footer = screen.getByTestId('timesheets-footer');
    await userEvent.click(within(footer).getByRole('button', { name: /submit timesheet/i }));

    // The confirm dialog opens (consequential action, still needs confirmation).
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Nothing has been saved or submitted yet (confirm not yet clicked).
    expect(saveWeekMutate).not.toHaveBeenCalled();
    expect(saveWeekMutateAsync).not.toHaveBeenCalled();
    expect(submitMutate).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: /^Submit timesheet$/i }));

    // saveWeekMutateAsync was called (auto-save).
    await waitFor(() => expect(saveWeekMutateAsync).toHaveBeenCalledTimes(1));
    // saveWeek was called with null currentTimesheetId (brand-new week).
    const saveArg = saveWeekMutateAsync.mock.calls[0][0] as { currentTimesheetId: string | null };
    expect(saveArg.currentTimesheetId).toBeNull();

    // submit.mutate was called AFTER saveWeek resolved, with the new sheet id.
    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
    expect(submitMutate).toHaveBeenCalledWith(
      { id: 'ts-new' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    // saveWeekMutate (fire-and-forget) was NOT called — only mutateAsync.
    expect(saveWeekMutate).not.toHaveBeenCalled();
  });

  it('AC-W3-O1: an already-saved clean week submits WITHOUT a redundant saveWeek call', async () => {
    // A Draft sheet exists with persisted hours and no local edits.
    const weekStr = currentWeekStartStr();
    tsState.data = [{
      id: 'ts-clean', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [
        { id: 'ec1', timesheet_id: 'ts-clean', project_id: 'pP', entry_date: weekStr, hours: 8,
          notes: null, project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
    }] as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;

    submitMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPage();

    const footer = screen.getByTestId('timesheets-footer');
    await userEvent.click(within(footer).getByRole('button', { name: /submit timesheet/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Submit timesheet$/i }));

    // No save was needed (no dirty rows).
    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
    expect(saveWeekMutate).not.toHaveBeenCalled();
    expect(saveWeekMutateAsync).not.toHaveBeenCalled();
    expect(submitMutate).toHaveBeenCalledWith(
      { id: 'ts-clean' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('AC-W3-O1 (review fix): a double-click on the confirm runs auto-save + submit only ONCE (re-entrancy guard)', async () => {
    // Fresh week, valid hours. The auto-save promise stays PENDING through both clicks (mock
    // isPending never flips) — exactly the window where the `loading` prop can't guard. The
    // synchronous submittingRef must block the second invocation (else two lazy-Draft creates).
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    let resolveSave: (id: string) => void = () => {};
    saveWeekMutateAsync.mockImplementation(() => new Promise<string>((res) => { resolveSave = res; }));
    submitMutate.mockImplementation(
      (_v: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/add a project/i), 'pQ');
    await userEvent.type(screen.getByLabelText('Acme Internal Platform, Mon hours'), '8');

    const footer = screen.getByTestId('timesheets-footer');
    await userEvent.click(within(footer).getByRole('button', { name: /submit timesheet/i }));
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /^Submit timesheet$/i });

    // Two rapid clicks while the auto-save is still in flight.
    await userEvent.click(confirmBtn);
    await userEvent.click(confirmBtn);

    // Guard held: auto-save fired exactly once despite two clicks.
    expect(saveWeekMutateAsync).toHaveBeenCalledTimes(1);

    // Resolve → the single submit proceeds once.
    resolveSave('ts-new');
    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
  });

  it('AC-W3-O1 (review fix): a persisted-valid week with an INVALID new edit DISABLES Submit (no silent submit of stale data)', async () => {
    const weekStr = currentWeekStartStr();
    tsState.data = [{
      id: 'ts-persisted', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
      entries: [
        { id: 'ep1', timesheet_id: 'ts-persisted', project_id: 'pP', entry_date: weekStr, hours: 8,
          notes: null, project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
    }] as unknown as TimesheetWithEntries[];
    tsState.isPending = false; tsState.isError = false;

    renderPage();
    const footer = screen.getByTestId('timesheets-footer');
    // Persisted valid entry → Submit starts enabled.
    expect(within(footer).getByRole('button', { name: /submit timesheet/i })).toBeEnabled();

    // Type an invalid value (25) into the persisted Monday cell.
    const mon = screen.getByLabelText('Innovate Corp HQ Fit-Out, Mon hours');
    await userEvent.clear(mon);
    await userEvent.type(mon, '25');

    // Submit must now be DISABLED — fix the invalid cell first; never silently submit stale data.
    expect(within(footer).getByRole('button', { name: /submit timesheet/i })).toBeDisabled();
  });
});
