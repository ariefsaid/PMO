import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import type { TimesheetsView } from '@/src/hooks/useTimesheetsView';

/**
 * A-6 Finance timesheet FE-gate (AC-W2-RBAC-011/012, rbac-visibility §I + policy
 * timesheet.create = Admin·Exec·PM·Engineer — Finance excluded):
 *   Finance has NO Workforce surface (Timesheets ○, Approvals ○). When Finance reaches
 *   /timesheets by URL they cannot enter or save hours — a clean access-denied surface, not a
 *   savable grid. The server-side RLS tightening is a SEPARATE pgTAP-owned security follow-up
 *   (out of scope here); this is the FE clarity gate (ADR-0016: FE may be stricter than RLS).
 *
 * Two-sided: an Engineer (authorized) keeps the editable grid + Save/Submit; Finance (denied)
 * gets no entry/save affordance.
 */
const weekStr = '2026-06-01';

const { tsState } = vi.hoisted(() => ({
  tsState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({ submit: { mutate: vi.fn(), isPending: false } }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));
const { viewState } = vi.hoisted(() => ({
  viewState: { value: 'grid' as TimesheetsView, setter: vi.fn() },
}));
vi.mock('@/src/hooks/useTimesheetsView', () => ({
  useTimesheetsView: () => [viewState.value, viewState.setter],
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

// Pin the clock so "this week" is the seeded week (2026-06-01 Mon), matching the Draft fixture.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-06-03T12:00:00'));
  tsState.isPending = false;
  tsState.isError = false;
  viewState.value = 'grid';
  viewState.setter.mockClear();
  sessionStorage.clear();
});

import Timesheets from '../../pages/Timesheets';

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

/**
 * AC-W3-N2 — Approvals queue toggle is gated on `may('transition','approval')`.
 *
 * An Engineer can create timesheets (canEnterTimesheet=true) but CANNOT transition
 * approvals. Showing the "Approvals queue" tab to an Engineer is a RBAC leak — the
 * rail correctly hides /approvals from Engineer. The toggle must match the rail.
 *
 * - Engineer: NO "Approvals queue" tab (the whole ViewToggle can collapse to a
 *   single option, or be hidden — either is acceptable as long as the tab is absent).
 * - Engineer with a stale persisted `view='approvals'`: the page defends by falling
 *   back to the grid (the approvals branch never renders).
 * - PM (approver): "Approvals queue" tab present.
 */
describe('Timesheets — Approvals toggle gate (AC-W3-N2)', () => {
  it('AC-W3-N2: an Engineer does NOT see the "Approvals queue" tab (RBAC leak)', () => {
    tsState.data = [
      { id: 'ts-d', user_id: 'u-self', week_start_date: weekStr, status: 'Draft', entries: [] },
    ] as unknown as TimesheetWithEntries[];
    viewState.value = 'grid';
    renderAs('Engineer');
    // The tab must not exist for a non-approver — exposure to a surface they can never use.
    expect(screen.queryByRole('tab', { name: /approvals queue/i })).not.toBeInTheDocument();
  });

  it('AC-W3-N2: a stale view="approvals" for an Engineer falls back to the grid (never shows the queue)', () => {
    tsState.data = [
      { id: 'ts-d', user_id: 'u-self', week_start_date: weekStr, status: 'Draft', entries: [] },
    ] as unknown as TimesheetWithEntries[];
    // Simulate stale persisted state: the session stored 'approvals' but the role can't use it.
    viewState.value = 'approvals';
    renderAs('Engineer');
    // The approvals queue MUST NOT render (the ApprovalsQueue component renders unique content).
    // The editable grid still renders (the grid's empty state / the footer with Save).
    expect(screen.queryByTestId('approvals-queue')).not.toBeInTheDocument();
    // The editable grid footer IS present (we fell back to grid).
    expect(screen.getByTestId('timesheets-footer')).toBeInTheDocument();
  });

  it('AC-W3-N2: a PM (approver) DOES see the "Approvals queue" tab', () => {
    tsState.data = [
      { id: 'ts-d', user_id: 'u-self', week_start_date: weekStr, status: 'Draft', entries: [] },
    ] as unknown as TimesheetWithEntries[];
    viewState.value = 'grid';
    renderAs('Project Manager');
    expect(screen.getByRole('tab', { name: /approvals queue/i })).toBeInTheDocument();
  });
});

describe('Timesheets — Finance FE entry-gate (A-6)', () => {
  it('AC-W2-RBAC-012: an Engineer keeps the editable grid with Save + Submit (authorized)', () => {
    tsState.data = [
      { id: 'ts-d', user_id: 'u-self', week_start_date: weekStr, status: 'Draft', entries: [] },
    ] as unknown as TimesheetWithEntries[];
    renderAs('Engineer');
    // The editable footer (Save + Submit) renders for the legitimate role.
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit timesheet/i })).toBeInTheDocument();
  });

  it('AC-W2-RBAC-011: Finance cannot enter or save hours (denied surface, no Save/Submit)', () => {
    tsState.data = [
      { id: 'ts-d', user_id: 'u-self', week_start_date: weekStr, status: 'Draft', entries: [] },
    ] as unknown as TimesheetWithEntries[];
    renderAs('Finance');
    // No entry/save affordance for Finance.
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit timesheet/i })).not.toBeInTheDocument();
    // A clean denied surface with a way back, not a savable grid.
    expect(screen.getByRole('region', { name: /don't have access/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
  });
});
