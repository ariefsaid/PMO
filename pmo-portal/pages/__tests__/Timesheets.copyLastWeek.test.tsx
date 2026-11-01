import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * "Copy last week" — one button fills the current week's edit buffer from last week's rows
 * (project structure + hours + note) while the week is still a draft.
 *
 * Oracles:
 *  - copy ADDS missing projects with day-shifted hours (Mon–Sun → Mon–Sun) and never writes
 *    on its own — the rows ride the explicit Save (dirty indicator);
 *  - duplicate guard: a project already present this week is skipped whole (one row, its
 *    existing hours untouched);
 *  - disabled with a plain visible reason when the week is not a draft, and when last week
 *    has no logged time.
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { sheetsState, projectsState } = vi.hoisted(() => ({
  sheetsState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectsState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
  },
}));

vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => sheetsState,
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
  useOwnTimesheetPushState: () => ({ data: null, isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
}));

vi.mock('@/src/auth/impersonation', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/auth/impersonation')>();
  return {
    ...real,
    useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }),
  };
});

import TimesheetsPage from '../Timesheets';

const solarProject = {
  id: 'p-solar-1',
  name: 'Meridian Solar Phase 1',
  code: 'SP-2401',
  status: 'Ongoing Project',
  client_id: 'cd-1',
  project_manager_id: 'pm-1',
  contract_value: 500000,
  start_date: '2024-01-01',
  end_date: '2025-12-31',
  client: { name: 'Meridian Steelworks' },
  pm: { full_name: 'Diego PM' },
};

const windmillProject = {
  id: 'p-windmill-2',
  name: 'Windmill Grid Alpha',
  code: 'WG-2402',
  status: 'Ongoing Project',
  client_id: 'cd-2',
  project_manager_id: 'pm-1',
  contract_value: 300000,
  start_date: '2024-02-01',
  end_date: '2025-12-31',
  client: { name: 'Grid Corp' },
  pm: { full_name: 'Diego PM' },
};

/** The page helper's Monday (week-start Date) — handles a Sunday "today" like the page does. */
function getWeekStartDate(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const currentWeekStr = () => iso(getWeekStartDate());
const lastWeekStr = () => {
  const d = getWeekStartDate();
  d.setDate(d.getDate() - 7);
  return iso(d);
};

let sheetSeq = 0;
function sheet(status: string, weekStr: string, entries: Array<Record<string, unknown>>) {
  sheetSeq += 1;
  return {
    id: `ts-${sheetSeq}`,
    user_id: 'u-self',
    week_start_date: weekStr,
    status,
    submitted_at: null,
    approved_by: null,
    approved_at: null,
    org_id: 'org-1',
    entries,
  };
}

let entrySeq = 0;
function entry(projectId: string, projectName: string, projectCode: string, entryDate: string, hours: number, notes: string | null = null) {
  entrySeq += 1;
  return {
    id: `e-${entrySeq}`,
    timesheet_id: `ts-holder-${entrySeq}`,
    project_id: projectId,
    entry_date: entryDate,
    hours,
    notes,
    project: { name: projectName, code: projectCode },
  };
}

const renderAtUrl = (url = '/timesheets') =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/timesheets" element={
            <ToastProvider>
              <TimesheetsPage />
            </ToastProvider>
          } />
        </Routes>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const copyButton = () => screen.getByRole('button', { name: 'Copy last week' });

beforeEach(() => {
  sheetSeq = 0;
  entrySeq = 0;
  sheetsState.data = [];
  sheetsState.isPending = false;
  sheetsState.isError = false;
  projectsState.data = [solarProject, windmillProject];
  projectsState.isPending = false;
  sheetsState.refetch.mockClear();
});

describe('Timesheets — Copy last week (draft weeks)', () => {
  it('copies last week rows into the empty draft week with shifted hours + note, and marks the week dirty (no silent write)', async () => {
    const lastMon = lastWeekStr();
    const lastFri = iso(shiftDays(getWeekStartDate(), -3)); // last week's Friday (Monday + 4)
    sheetsState.data = [
      sheet('Draft', lastMon, [
        entry('p-solar-1', 'Meridian Solar Phase 1', 'SP-2401', lastMon, 8, 'Site visit'),
        entry('p-solar-1', 'Meridian Solar Phase 1', 'SP-2401', lastFri, 6),
      ]),
    ];
    renderAtUrl();

    expect(screen.getByTestId('timesheets-empty')).toBeInTheDocument();
    expect(copyButton()).toBeEnabled();

    await userEvent.click(copyButton());

    // The grid now carries the copied row with last week's Monday hours shifted onto this Monday…
    expect(screen.queryByTestId('timesheets-empty')).not.toBeInTheDocument();
    const grid = screen.getByTestId('tsgrid-table');
    expect(within(grid).getByText('Meridian Solar Phase 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Meridian Solar Phase 1, Mon hours')).toHaveValue('8');
    expect(screen.getByLabelText('Meridian Solar Phase 1, Fri hours')).toHaveValue('6');
    expect(screen.getByLabelText('Meridian Solar Phase 1, Tue hours')).toHaveValue('');

    // …the note came along…
    expect(screen.getByLabelText('Meridian Solar Phase 1 note')).toHaveValue('Site visit');

    // …and nothing was written: the copy is buffer state awaiting the explicit Save.
    expect(screen.getByTestId('timesheets-save-status')).toHaveTextContent('Unsaved changes');
    expect(await screen.findByText('Rows copied from last week')).toBeInTheDocument();
  });

  it('duplicate guard: a project already present this week stays exactly one row with its own hours; only missing projects are added', async () => {
    const currentWeek = currentWeekStr();
    const lastWeek = lastWeekStr();
    sheetsState.data = [
      sheet('Draft', currentWeek, [
        entry('p-windmill-2', 'Windmill Grid Alpha', 'WG-2402', currentWeek, 4),
      ]),
      sheet('Draft', lastWeek, [
        entry('p-windmill-2', 'Windmill Grid Alpha', 'WG-2402', lastWeek, 9),
        entry('p-solar-1', 'Meridian Solar Phase 1', 'SP-2401', lastWeek, 5),
      ]),
    ];
    renderAtUrl();

    expect(copyButton()).toBeEnabled();
    await userEvent.click(copyButton());

    const grid = screen.getByTestId('tsgrid-table');
    // Windmill: ONE row — last week's 9h did NOT duplicate or clobber this week's 4h.
    expect(within(grid).getAllByText('Windmill Grid Alpha')).toHaveLength(1);
    expect(screen.getByLabelText('Windmill Grid Alpha, Mon hours')).toHaveValue('4');
    // Solar: added from last week.
    expect(within(grid).getAllByText('Meridian Solar Phase 1')).toHaveLength(1);
    expect(screen.getByLabelText('Meridian Solar Phase 1, Mon hours')).toHaveValue('5');
  });

  it('is disabled with a plain reason when the week is not a draft', () => {
    const currentWeek = currentWeekStr();
    sheetsState.data = [
      sheet('Submitted', currentWeek, [
        entry('p-windmill-2', 'Windmill Grid Alpha', 'WG-2402', currentWeek, 4),
      ]),
    ];
    renderAtUrl();

    expect(copyButton()).toBeDisabled();
    expect(screen.getByTestId('timesheets-copy-reason')).toHaveTextContent(
      'This week is no longer a draft'
    );
  });

  it('is disabled with a plain reason when last week has no logged time', () => {
    sheetsState.data = [];
    renderAtUrl();

    expect(copyButton()).toBeDisabled();
    expect(screen.getByTestId('timesheets-copy-reason')).toHaveTextContent(
      'Nothing to copy — no time was logged last week'
    );
  });

  it('is disabled with a plain reason when last week\u2019s projects are all already in this week', () => {
    const currentWeek = currentWeekStr();
    const lastWeek = lastWeekStr();
    sheetsState.data = [
      sheet('Draft', currentWeek, [
        entry('p-solar-1', 'Meridian Solar Phase 1', 'SP-2401', currentWeek, 2),
      ]),
      sheet('Draft', lastWeek, [
        entry('p-solar-1', 'Meridian Solar Phase 1', 'SP-2401', lastWeek, 8),
      ]),
    ];
    renderAtUrl();

    expect(copyButton()).toBeDisabled();
    expect(screen.getByTestId('timesheets-copy-reason')).toHaveTextContent(
      'already in this week'
    );
  });
});

function shiftDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}
