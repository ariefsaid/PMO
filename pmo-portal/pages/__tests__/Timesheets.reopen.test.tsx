/**
 * AC-W3-B1 — Timesheet: Rejected → Draft rework has no UI (lifecycle rework dead-end fix).
 *
 * A returned (Rejected) timesheet shows an ErrBanner but gave the owner no way to actually
 * reopen it for editing. The server allows Rejected → Draft via `transition_timesheet(id,'Draft')`.
 *
 * Spec:
 *   - Owner of a Rejected sheet sees a "Revise this week" button near the ErrBanner.
 *   - Clicking it calls reopenTimesheet (→ Draft) with the sheet id and shows a success toast.
 *   - It is single-click (NOT a confirm dialog) — OD-UX-1: routine reversible step.
 *   - A non-owner of a Rejected sheet does NOT see the button.
 *   - The button is absent on a non-Rejected sheet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// ── Clock pin — same week-anchoring trick used in the other timesheet test files. ──
const PINNED_NOW = new Date('2026-06-03T12:00:00');
const WEEK_STR = '2026-06-01'; // Monday of the pinned week
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Mocks ────────────────────────────────────────────────────────────────────

const reopenMutate = vi.fn();
const reopenMutateAsync = vi.fn().mockResolvedValue(undefined);

const { tsState } = vi.hoisted(() => ({
  tsState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-owner', org_id: 'org-1' }, role: 'Engineer' }),
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: reopenMutate, mutateAsync: reopenMutateAsync, isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue('ts-auto'), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [] }),
}));

import Timesheets from '../Timesheets';

/** A Rejected sheet owned by u-owner for the current pinned week. */
function rejectedSheet(userId = 'u-owner'): TimesheetWithEntries[] {
  return [{
    id: 'ts-rej', user_id: userId, week_start_date: WEEK_STR, status: 'Rejected',
    submitted_at: '2026-06-02T10:00:00Z', approved_by: null, approved_at: null, org_id: 'org-1',
    entries: [
      { id: 'er1', timesheet_id: 'ts-rej', project_id: 'pr1', entry_date: WEEK_STR, hours: 8,
        notes: 'Needs rework', project: { name: 'Site Alpha', code: 'SA01' } },
    ],
  }] as unknown as TimesheetWithEntries[];
}

/** A Draft sheet owned by u-owner for the current pinned week. */
function draftSheet(): TimesheetWithEntries[] {
  return [{
    id: 'ts-draft', user_id: 'u-owner', week_start_date: WEEK_STR, status: 'Draft',
    submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
    entries: [],
  }] as unknown as TimesheetWithEntries[];
}

const renderPage = (realRole: 'Engineer' | 'Project Manager' = 'Engineer') =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  sessionStorage.clear();
  reopenMutate.mockClear();
  reopenMutateAsync.mockReset();
  reopenMutateAsync.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AC-W3-B1: Timesheet Rejected → Draft rework action', () => {
  it('AC-W3-B1: owner of a Rejected sheet sees a "Revise this week" button near the ErrBanner', () => {
    tsState.data = rejectedSheet('u-owner');
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    // The ErrBanner must still be present
    expect(screen.getByText(/returned for changes/i)).toBeInTheDocument();
    // The rework button must be present
    expect(screen.getByRole('button', { name: /revise this week/i })).toBeInTheDocument();
  });

  it('AC-W3-B1: clicking "Revise this week" calls the reopen mutation with the sheet id (→ Draft), single-click (no confirm dialog)', async () => {
    tsState.data = rejectedSheet('u-owner');
    tsState.isPending = false; tsState.isError = false;

    reopenMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /revise this week/i }));

    // Must NOT open a confirm dialog (routine reversible step — OD-UX-1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Must call reopen mutation with the sheet id
    expect(reopenMutate).toHaveBeenCalledWith(
      { id: 'ts-rej' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('AC-W3-B1: a success toast fires after the reopen mutation succeeds', async () => {
    tsState.data = rejectedSheet('u-owner');
    tsState.isPending = false; tsState.isError = false;

    reopenMutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /revise this week/i }));
    // The toast container renders toasts in a fixed region (role="status" elements with text).
    // The ErrBanner also has role="status" — match the toast by content.
    await waitFor(() =>
      expect(screen.getAllByRole('status').some(
        (el) => /reopen|draft|editing|revision/i.test(el.textContent ?? '')
      )).toBe(true)
    );
  });

  it('AC-W3-B1: a non-owner (different user_id) of a Rejected sheet does NOT see the "Revise" button', () => {
    // Sheet owned by 'other-user'; signed-in user is 'u-owner' → not the owner
    tsState.data = rejectedSheet('other-user');
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    expect(screen.queryByRole('button', { name: /revise this week/i })).not.toBeInTheDocument();
  });

  it('AC-W3-B1: on a non-Rejected (Draft) sheet the "Revise" button is absent', () => {
    tsState.data = draftSheet();
    tsState.isPending = false; tsState.isError = false;
    renderPage();
    expect(screen.queryByRole('button', { name: /revise this week/i })).not.toBeInTheDocument();
  });
});
