/**
 * AC-W2-8-03: "Revise this week" is locked out while reopen is pending (no double-fire).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const PINNED_NOW = new Date('2026-06-03T12:00:00');
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const reopenMutate = vi.fn();

// The timesheet is in Rejected state (returned by manager) — owned by 'u-alice'
const tsState = {
  data: [
    {
      id: 'ts-pm',
      user_id: 'u-alice',
      week_start_date: '2026-06-01',
      status: 'Rejected',
      submitted_at: '2026-06-02T10:00:00Z',
      approved_by: null,
      approved_at: null,
      org_id: 'org-1',
      entries: [
        {
          id: 'e1',
          timesheet_id: 'ts-pm',
          project_id: 'pr1',
          entry_date: '2026-06-01',
          hours: 6,
          notes: null,
          project: { name: 'Test Project', code: 'P001' },
        },
      ],
    },
  ] as unknown as TimesheetWithEntries[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: reopenMutate, isPending: true },  // isPending = true → lockout
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
  // I-16/I-17: the owner's own ERP push state. No mirror row here (an unflipped org).
  useOwnTimesheetPushState: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue('ts-pm'), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [] }),
}));

import Timesheets from '../Timesheets';

describe('Timesheets revise lockout (W2-8)', () => {
  it('AC-W2-8-03: "Revise this week" button is disabled while reopen is pending', async () => {
    renderPage();

    // The ErrBanner for "returned for changes" should show
    const reviseBtn = await screen.findByRole('button', { name: /revise this week/i });

    // While reopen.isPending = true, the button must be disabled
    expect(reviseBtn).toBeDisabled();
  });

  it('AC-W2-8-03: clicking a disabled Revise button does not fire reopen.mutate', async () => {
    const user = userEvent.setup();
    renderPage();

    const reviseBtn = await screen.findByRole('button', { name: /revise this week/i });
    expect(reviseBtn).toBeDisabled();

    // Try clicking anyway — should not call mutate
    await user.click(reviseBtn);
    expect(reopenMutate).not.toHaveBeenCalled();
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );
}
