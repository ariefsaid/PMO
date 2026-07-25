import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import Timesheets from '../Timesheets';

/**
 * AC-IXD-TS-002 + AC-IXD-TS-004 (timesheet Save+Submit, OD-UX-1; plan tasks 13/14/16).
 *
 *  AC-IXD-TS-002 — Save AND Submit render in the SAME footer action zone (not
 *    Submit-in-header + Save-in-footer). Submit is the primary; Save is the
 *    secondary. Submit is shown FROM FIRST PAINT, disabled with the helper
 *    "Save your hours first" until a Draft with persisted hours exists, then
 *    enabled. No split-region primaries; the page header carries no Submit.
 *
 *  AC-IXD-TS-004 — the redundant "By project this week" and "Recent entries
 *    this week" rollup panels are NOT rendered below the grid (the grid totals
 *    are the single source of truth; the rollups live on the dashboard only).
 */

const PINNED_NOW = new Date('2026-06-03T12:00:00');
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Monday of the pinned current week, YYYY-MM-DD (matches the page's week logic). */
function currentWeekStartStr(): string {
  const today = new Date(PINNED_NOW);
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today);
  monday.setDate(diff);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

const submitMutate = vi.fn();
const tsState: {
  data: TimesheetWithEntries[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: [], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Engineer' }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: submitMutate, isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
  // I-16/I-17: the owner's own ERP push state. No mirror row here (an unflipped org).
  useOwnTimesheetPushState: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));

// An IC (Engineer) entering hours is the natural journey; render under the Engineer real role
// so the A-6 entry-gate (Admin·Exec·PM·Engineer) keeps the editable grid + Save/Submit footer.
const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

/** A Draft sheet owned by u-alice for the current week. */
function draftSheet(entries: unknown[]): TimesheetWithEntries[] {
  const weekStr = currentWeekStartStr();
  return [{
    id: 'ts-draft', user_id: 'u-alice', week_start_date: weekStr, status: 'Draft',
    submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
    entries,
  }] as unknown as TimesheetWithEntries[];
}

beforeEach(() => {
  sessionStorage.clear();
  submitMutate.mockClear();
});

// ---------------------------------------------------------------------------
// AC-IXD-TS-002 — Save + Submit co-located in the footer; Submit from first paint
// ---------------------------------------------------------------------------
describe('AC-IXD-TS-002: Save and Submit are co-located in the grid footer (no split-region primaries)', () => {
  it('AC-IXD-TS-002: both Save and Submit live in the same footer action zone', () => {
    tsState.data = draftSheet([
      { id: 'e1', timesheet_id: 'ts-draft', project_id: 'pr1', entry_date: currentWeekStartStr(), hours: 8,
        notes: null, project: { name: 'Alpha Project', code: 'A001' } },
    ]);
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    const footer = screen.getByTestId('timesheets-footer');
    const saveBtn = within(footer).getByRole('button', { name: /^save$/i });
    const submitBtn = within(footer).getByRole('button', { name: /submit timesheet/i });
    expect(saveBtn).toBeInTheDocument();
    expect(submitBtn).toBeInTheDocument();
  });

  it('AC-IXD-TS-002: the page header carries NO Submit button (Submit is not split into the header)', () => {
    tsState.data = draftSheet([
      { id: 'e1', timesheet_id: 'ts-draft', project_id: 'pr1', entry_date: currentWeekStartStr(), hours: 8,
        notes: null, project: { name: 'Alpha Project', code: 'A001' } },
    ]);
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    // The h1 header region must NOT contain a Submit affordance.
    const heading = screen.getByRole('heading', { name: /timesheets/i });
    const headerRegion = heading.closest('div')?.parentElement as HTMLElement;
    expect(within(headerRegion).queryByRole('button', { name: /submit timesheet/i })).toBeNull();
    // Exactly one Submit control overall (it lives only in the footer).
    expect(screen.getAllByRole('button', { name: /submit timesheet/i })).toHaveLength(1);
  });

  it('AC-IXD-TS-002 + AC-W3-O1: Submit shows from FIRST PAINT but disabled with "Enter hours to submit" on a brand-new empty week', () => {
    // No sheet at all yet, no hours typed → Submit must still render, disabled.
    // OD-W3-1: hint text changed from "Save your hours first" to "Enter hours to submit" because
    // Submit now auto-saves, making the old "save first" instruction incorrect.
    tsState.data = [];
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    const footer = screen.getByTestId('timesheets-footer');
    const submitBtn = within(footer).getByRole('button', { name: /submit timesheet/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();
    // The first click does not submit (disabled affordance, not hidden).
    expect(within(footer).getByText(/enter hours to submit/i)).toBeInTheDocument();
  });

  it('AC-IXD-TS-002: Submit is disabled on a Draft week that has NO persisted hours yet', () => {
    // A Draft sheet exists but with zero entries — nothing to submit until hours are saved.
    tsState.data = draftSheet([]);
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    const footer = screen.getByTestId('timesheets-footer');
    expect(within(footer).getByRole('button', { name: /submit timesheet/i })).toBeDisabled();
  });

  it('AC-IXD-TS-002: Submit becomes ENABLED once the Draft has at least one persisted entry', () => {
    tsState.data = draftSheet([
      { id: 'e1', timesheet_id: 'ts-draft', project_id: 'pr1', entry_date: currentWeekStartStr(), hours: 8,
        notes: null, project: { name: 'Alpha Project', code: 'A001' } },
    ]);
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    const footer = screen.getByTestId('timesheets-footer');
    expect(within(footer).getByRole('button', { name: /submit timesheet/i })).toBeEnabled();
  });

  it('AC-IXD-TS-002: the footer Save is secondary and Submit is the primary action', () => {
    tsState.data = draftSheet([
      { id: 'e1', timesheet_id: 'ts-draft', project_id: 'pr1', entry_date: currentWeekStartStr(), hours: 8,
        notes: null, project: { name: 'Alpha Project', code: 'A001' } },
    ]);
    tsState.isPending = false; tsState.isError = false;
    renderPage();

    const footer = screen.getByTestId('timesheets-footer');
    const submitBtn = within(footer).getByRole('button', { name: /submit timesheet/i });
    // The primary blue One-Blue variant renders bg-primary; the secondary Save does not.
    expect(submitBtn.className).toMatch(/bg-primary/);
    const saveBtn = within(footer).getByRole('button', { name: /^save$/i });
    expect(saveBtn.className).not.toMatch(/bg-primary/);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-TS-004 — redundant rollup panels removed from the entry screen
// ---------------------------------------------------------------------------
describe('AC-IXD-TS-004: the entry screen drops the redundant rollup panels', () => {
  beforeEach(() => {
    tsState.data = draftSheet([
      { id: 'e1', timesheet_id: 'ts-draft', project_id: 'pr1', entry_date: currentWeekStartStr(), hours: 6,
        notes: 'Planning', project: { name: 'Alpha Project', code: 'A001' } },
    ]);
    tsState.isPending = false; tsState.isError = false;
  });

  it('AC-IXD-TS-004: "By project this week" rollup panel is NOT rendered', () => {
    renderPage();
    expect(screen.queryByRole('group', { name: /by project this week/i })).toBeNull();
    expect(screen.queryByText(/by project this week/i)).toBeNull();
  });

  it('AC-IXD-TS-004: "Recent entries this week" rollup panel is NOT rendered', () => {
    renderPage();
    expect(screen.queryByText(/recent entries this week/i)).toBeNull();
  });
});
